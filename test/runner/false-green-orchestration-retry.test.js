'use strict';

/**
 * false-green-orchestration-retry.test.js — FG-K series.
 *
 * SCENARIO THIS FILE DEFENDS (hypothetical change HC-4):
 *   "Close A3-F4: when a coordinator worker fails or returns low confidence,
 *    retry it up to N times with exponential backoff."
 *
 * Retry is the classic accounting-corrupting feature. Everything it breaks is
 * arithmetic that no existing test quantifies over, and every symptom looks
 * like success — the fan-out completes, the synthesis is written, the exit code
 * is 0. What silently changes is the budget ledger.
 *
 * The specific ways HC-4 lands green and wrong:
 *
 *   - Re-acquiring a lease for the retry WITHOUT releasing the failed attempt's
 *     lease. Tokens stay reserved forever; later siblings are refused; the run
 *     "completes" having done less work than asked. The broker's own invariant
 *     (active leases + usage <= caps) still holds, so nothing throws.
 *
 *   - Folding the failed attempt's usage into totalUsage AND the retry's usage
 *     as well. The bill doubles; the run succeeds.
 *
 *   - Wrapping the worker call in try/catch for the retry loop, which also
 *     swallows the loud errors groupPhasePlanByDeps throws for malformed specs
 *     (cycles, missing deps). A cyclic plan silently serialises instead of
 *     failing.
 *
 *   - Retrying a worker that was REFUSED for lack of budget, in the hope that
 *     the next attempt fits. If refusal were not idempotent, a retry loop would
 *     eventually spend past the ceiling.
 *
 * These tests exercise the real broker and the real plan-grouping helpers, and
 * they assert PROPERTIES over sequences rather than pinning single examples,
 * because a retry loop is exactly a sequence.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createBudgetBroker } = require('../../src/runner/budget-broker');
const {
  groupPhasePlanByDeps,
  runPhasePlan,
  computeLeaseRequest,
  batchSizeById,
} = require('../../src/runner/coordinator');

const CAPS = { inputCap: 10_000, outputCap: 4_000 };

function freshUsage() {
  return { input_tokens: 0, output_tokens: 0 };
}

/** The invariant the broker exists to uphold, checked from the outside. */
function assertNeverOversubscribed(broker, usage, label) {
  const snap = broker.snapshot(usage);
  assert.ok(
    snap.leased.input_tokens + snap.used.input_tokens <= snap.caps.input_tokens,
    `${label}: input leases + usage (${snap.leased.input_tokens}+${snap.used.input_tokens}) exceeded cap ${snap.caps.input_tokens}`,
  );
  assert.ok(
    snap.leased.output_tokens + snap.used.output_tokens <= snap.caps.output_tokens,
    `${label}: output leases + usage exceeded cap`,
  );
}

describe('FG-K budget accounting under retry', () => {
  // FG-K1: the headline property. Drive a realistic retry sequence —
  // acquire, fail, re-acquire, succeed, across several workers — and assert the
  // oversubscription invariant after EVERY step, not just at the end.
  it('FG-K1: leases never oversubscribe the cap across an acquire/fail/retry sequence', () => {
    const broker = createBudgetBroker(CAPS);
    const usage = freshUsage();

    for (let worker = 0; worker < 4; worker++) {
      const first = broker.acquire(usage, computeLeaseRequest(broker, usage, 4));
      if (!first) break;
      assertNeverOversubscribed(broker, usage, `worker ${worker} attempt 1`);

      // Attempt 1 fails with no usage — the retry MUST release before re-acquiring.
      const released = broker.release(first.leaseId, null);
      assert.equal(released.incomplete, true, 'a failed attempt must be recorded as incomplete');
      assertNeverOversubscribed(broker, usage, `worker ${worker} after release`);

      const retry = broker.acquire(usage, computeLeaseRequest(broker, usage, 4));
      if (!retry) break;
      assertNeverOversubscribed(broker, usage, `worker ${worker} attempt 2`);

      const done = broker.release(retry.leaseId, { input_tokens: 500, output_tokens: 200 });
      assert.equal(done.reconciled, true);
      usage.input_tokens += done.usage.input_tokens;
      usage.output_tokens += done.usage.output_tokens;
      assertNeverOversubscribed(broker, usage, `worker ${worker} reconciled`);
    }

    assert.equal(broker.snapshot(usage).active_leases, 0, 'every lease must be released by the end of the run');
  });

  // FG-K2: the leak shape. If a retry re-acquires without releasing, the
  // reservation is still counted. Assert that the leak is VISIBLE in the
  // snapshot rather than being absorbed silently — that visibility is what a
  // future field test would rely on.
  it('FG-K2: re-acquiring without releasing leaves an observable reservation leak', () => {
    const broker = createBudgetBroker(CAPS);
    const usage = freshUsage();

    const first = broker.acquire(usage, { input_tokens: 4_000, output_tokens: 1_000 });
    const retry = broker.acquire(usage, { input_tokens: 4_000, output_tokens: 1_000 }); // no release: the bug
    assert.ok(first && retry);

    const snap = broker.snapshot(usage);
    assert.equal(snap.active_leases, 2, 'both reservations must be counted — a silent overwrite would hide the leak');
    assert.equal(snap.leased.input_tokens, 8_000);
    assertNeverOversubscribed(broker, usage, 'double-acquire');

    // The reserved tokens really are unavailable: a third request for the same
    // size is CLAMPED to what is left (2_000 of the 4_000 asked for) rather than
    // being handed tokens that are already spoken for...
    const third = broker.acquire(usage, { input_tokens: 4_000, output_tokens: 1_000 });
    assert.equal(third.input_tokens, 2_000, 'a request larger than the remainder must be clamped, not granted in full');
    assertNeverOversubscribed(broker, usage, 'clamped third acquire');

    // ...and once the remainder is genuinely zero, the next attempt is refused.
    assert.equal(
      broker.acquire(usage, { input_tokens: 1, output_tokens: 1 }),
      null,
      'an exhausted input dimension must refuse outright',
    );
  });

  // FG-K3: double-counting. A retry loop that releases the same lease twice
  // must NOT be handed a second usage object to fold into the total — that is
  // how a bill silently doubles.
  it('FG-K3: releasing the same lease twice yields no second usage to add', () => {
    const broker = createBudgetBroker(CAPS);
    const usage = freshUsage();
    const lease = broker.acquire(usage, { input_tokens: 1_000, output_tokens: 500 });

    const first = broker.release(lease.leaseId, { input_tokens: 900, output_tokens: 400 });
    assert.equal(first.reconciled, true);
    assert.equal(first.usage.input_tokens, 900);

    const second = broker.release(lease.leaseId, { input_tokens: 900, output_tokens: 400 });
    assert.equal(second.reconciled, false, 'a double release must not reconcile');
    assert.equal(second.reason, 'unknown_lease');
    assert.equal(second.usage, undefined, 'a double release must not return usage a caller could add twice');
  });

  // FG-K4: refusal must be idempotent. A retry loop asks again; if an exhausted
  // broker ever answered "yes", retries would spend past the ceiling.
  it('FG-K4: refusal is idempotent once the budget is exhausted', () => {
    const broker = createBudgetBroker({ inputCap: 100, outputCap: 100 });
    const usage = { input_tokens: 100, output_tokens: 100 };
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(broker.acquire(usage), null, `retry attempt ${attempt} was granted a lease past the cap`);
    }
    // A zero-length remainder on ONE dimension is enough to refuse.
    const partial = createBudgetBroker({ inputCap: 100, outputCap: 100 });
    assert.equal(partial.acquire({ input_tokens: 100, output_tokens: 0 }), null, 'exhausting input alone must refuse');
  });

  // FG-K5: incomplete children must stay surfaced. A retry that eventually
  // succeeds must not erase the record that an earlier attempt was never
  // reconciled — that record is what makes a usage total honest.
  it('FG-K5: an unreconciled attempt is still reported after a later success', () => {
    const broker = createBudgetBroker(CAPS);
    const usage = freshUsage();

    broker.release(broker.acquire(usage, { input_tokens: 100, output_tokens: 100 }).leaseId, null);
    assert.equal(broker.hasIncompleteChildren(), true);

    const retry = broker.acquire(usage, { input_tokens: 100, output_tokens: 100 });
    broker.release(retry.leaseId, { input_tokens: 50, output_tokens: 50 });

    assert.equal(
      broker.hasIncompleteChildren(),
      true,
      'a later success must not clear the incomplete record — the run’s usage total is still partial',
    );
    assert.equal(broker.snapshot(usage).incomplete.length, 1);
  });

  // FG-K6: an uncapped run must not fabricate leases that a retry loop could
  // mistake for reconcilable work.
  it('FG-K6: an uncapped broker issues no leases and reports unconstrained releases', () => {
    const broker = createBudgetBroker({});
    const usage = freshUsage();
    const lease = broker.acquire(usage);
    assert.equal(lease.unconstrained, true);
    assert.equal(lease.leaseId, null);

    const released = broker.release(lease.leaseId, null);
    assert.equal(released.unconstrained, true);
    assert.equal(released.incomplete, false, 'an uncapped spawn must not be recorded as an incomplete child');
    assert.equal(broker.hasIncompleteChildren(), false);
  });
});

describe('FG-K plan grouping stays deterministic and loud', () => {
  const PLAN = [
    { id: 'c', deps: ['a'] },
    { id: 'a', deps: [] },
    { id: 'b', deps: ['a'] },
    { id: 'd', deps: ['b', 'c'] },
  ];

  // FG-K7: batching must depend only on the dependency graph, never on the
  // order nodes happen to arrive in. A retry that re-submits a plan with the
  // failed node moved to the front must produce the same batches — otherwise
  // "it worked on the retry" becomes an ordering accident.
  it('FG-K7: batch membership is identical under every input ordering', () => {
    const canonical = groupPhasePlanByDeps(PLAN).map((b) => [...b].sort());

    const permutations = [
      [PLAN[1], PLAN[0], PLAN[2], PLAN[3]],
      [PLAN[3], PLAN[2], PLAN[1], PLAN[0]],
      [PLAN[2], PLAN[3], PLAN[0], PLAN[1]],
      [PLAN[0], PLAN[3], PLAN[1], PLAN[2]],
    ];
    for (const perm of permutations) {
      const got = groupPhasePlanByDeps(perm).map((b) => [...b].sort());
      assert.deepEqual(got, canonical, 'batching changed with input order: ' + JSON.stringify(perm.map((p) => p.id)));
    }
  });

  // FG-K8: the actual correctness property — every dependency must land in a
  // STRICTLY earlier batch. A "simplification" that merged batches would keep
  // the node count identical and break concurrency safety.
  it('FG-K8: every dependency resolves in a strictly earlier batch', () => {
    const batches = groupPhasePlanByDeps(PLAN);
    const batchIndex = new Map();
    batches.forEach((batch, i) => batch.forEach((id) => batchIndex.set(id, i)));

    for (const node of PLAN) {
      for (const dep of node.deps) {
        assert.ok(
          batchIndex.get(dep) < batchIndex.get(node.id),
          `${node.id} runs in batch ${batchIndex.get(node.id)} but depends on ${dep} in batch ${batchIndex.get(dep)}`,
        );
      }
    }
    assert.equal(batches.flat().length, PLAN.length, 'every node must be scheduled exactly once');
  });

  // FG-K9: malformed plans must keep throwing. A retry wrapper naturally wraps
  // the call site in try/catch; if it swallows these, a cyclic plan degrades to
  // silent serialisation instead of a loud failure.
  it('FG-K9: cycles, missing deps and duplicate ids all still throw', () => {
    assert.throws(
      () =>
        groupPhasePlanByDeps([
          { id: 'x', deps: ['y'] },
          { id: 'y', deps: ['x'] },
        ]),
      /cycle/i,
    );
    assert.throws(() => groupPhasePlanByDeps([{ id: 'x', deps: ['ghost'] }]), /missing dep/i);
    assert.throws(
      () =>
        groupPhasePlanByDeps([
          { id: 'x', deps: [] },
          { id: 'x', deps: [] },
        ]),
      /duplicate id/i,
    );
    assert.throws(() => groupPhasePlanByDeps([{ deps: [] }]), /missing id/i);
  });

  // FG-K10: a worker rejection must propagate out of runPhasePlan. If a retry
  // implementation converts a rejection into a resolved "failed" result, the
  // coordinator's own error handling (which releases the lease) stops running.
  it('FG-K10: a throwing worker rejects the phase rather than resolving', async () => {
    const plan = [
      { id: 'a', deps: [] },
      { id: 'b', deps: ['a'] },
    ];
    await assert.rejects(
      () => runPhasePlan(plan, (id) => (id === 'b' ? Promise.reject(new Error('worker exploded')) : 'ok')),
      /worker exploded/,
    );
  });

  // FG-K11: concurrent siblings must each get a usable slice, and the slices
  // must never sum above the remainder. A retry that adds an extra runner to a
  // batch without updating the divisor is exactly how the first sibling eats
  // the whole budget.
  it('FG-K11: per-sibling lease slices sum to no more than the remainder', () => {
    const broker = createBudgetBroker(CAPS);
    const usage = freshUsage();
    const sizes = batchSizeById(PLAN);
    const divisor = sizes.get('b'); // 'b' and 'c' share a batch
    assert.equal(divisor, 2, 'batchSizeById must report the concurrent sibling count');

    const before = broker.unleasedRemaining(usage);
    let leasedInput = 0;
    for (let i = 0; i < divisor; i++) {
      const lease = broker.acquire(usage, computeLeaseRequest(broker, usage, divisor));
      assert.ok(lease, `sibling ${i} was refused a slice — the first sibling took everything`);
      assert.ok(lease.input_tokens > 0, `sibling ${i} got a zero-token slice`);
      leasedInput += lease.input_tokens;
    }
    assert.ok(leasedInput <= before.input_tokens, 'sibling slices oversubscribed the remainder');
    assertNeverOversubscribed(broker, usage, 'sibling fan-out');

    // A divisor of 1 (or none) must keep the historical whole-remainder behavior.
    assert.deepEqual(computeLeaseRequest(broker, usage, 1), {}, 'divisor 1 must not change acquire() semantics');
  });
});
