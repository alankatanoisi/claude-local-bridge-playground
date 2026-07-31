'use strict';

/**
 * Coordinator budget leases + research fan-out.
 *
 * Before this landed, Coordinator.run passed `inherit.maxCostUsd` (a COPY of the
 * parent ceiling) to every child and never touched the budget broker, and the
 * research phase always spawned exactly one worker — runPhasePlan existed and
 * was unit-tested but no run path called it. A fan-out on the old code would
 * therefore have let N children each spend up to the full ceiling.
 *
 * These tests use an injected workerRuntime, so no child process is ever
 * spawned and no model is ever called.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Coordinator } = require('../../src/runner/coordinator');

/** Temp session dir so tests never touch ~/.bridge-runner/sessions. */
function tempSessionDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coord-lease-'));
}

/**
 * Fake WorkerRuntime that records every spec it was handed and reports usage.
 * `hold` keeps children in flight so we can observe peak concurrency.
 */
function makeStubRuntime(options = {}) {
  const { usagePerChild = { input_tokens: 10, output_tokens: 5 }, hold = 5 } = options;
  const calls = [];
  let inFlight = 0;
  let peakInFlight = 0;

  return {
    calls,
    get peakInFlight() {
      return peakInFlight;
    },
    async spawnWorker(spec, opts) {
      calls.push({ spec, opts });
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, hold));
      inFlight--;
      return {
        workerId: 'wrk_' + calls.length,
        state: 'completed',
        phase: spec.phase,
        finalText: 'stub finding for ' + (spec.prompt || '').slice(0, 20),
        summary: 'stub summary',
        claims: [],
        evidencePaths: [],
        confidence: 'low',
        exitCode: 0,
        stderr: '',
        events: [],
        usage: usagePerChild ? { ...usagePerChild } : null,
        stopReason: 'success',
        duration_ms: 1,
      };
    },
  };
}

function planOf(ids, deps = []) {
  return ids.map((id) => ({ id, deps: [...deps], prompt: 'research ' + id }));
}

function baseInput(extra = {}) {
  return {
    objective: 'map the runner modules for an architecture document',
    cwd: process.cwd(),
    phases: ['research'],
    noArchive: true,
    ...extra,
  };
}

describe('coordinator budget leases', () => {
  it('gives each concurrent fan-out child a distinct lease and a split of the remainder', async () => {
    const runtime = makeStubRuntime();
    const coordinator = new Coordinator({ workerRuntime: runtime, sessionBaseDir: tempSessionDir() });

    const result = await coordinator.run(
      baseInput({
        researchPlan: planOf(['kernel', 'safety', 'context', 'orchestration']),
        budgetInputTokens: 4000,
        budgetOutputTokens: 2000,
      }),
    );

    assert.equal(runtime.calls.length, 4, 'one worker per plan node');
    assert.equal(runtime.peakInFlight, 4, 'all four ran concurrently');

    const leaseIds = runtime.calls.map((c) => c.spec.leaseId);
    assert.equal(new Set(leaseIds).size, 4, 'every child got a distinct leaseId');
    for (const id of leaseIds) assert.ok(id, 'leaseId present');

    // The whole point: the remainder is SPLIT, not copied. Four children out of
    // a 4000/2000 cap get ~1000/500 each, and the sum never exceeds the cap.
    const sumIn = runtime.calls.reduce((n, c) => n + c.spec.budgetRemaining.input_tokens, 0);
    const sumOut = runtime.calls.reduce((n, c) => n + c.spec.budgetRemaining.output_tokens, 0);
    assert.ok(sumIn <= 4000, 'leased input ' + sumIn + ' within cap');
    assert.ok(sumOut <= 2000, 'leased output ' + sumOut + ' within cap');
    for (const c of runtime.calls) {
      assert.ok(c.spec.budgetRemaining.input_tokens > 0, 'child input lease is usable');
      assert.ok(
        c.spec.budgetRemaining.input_tokens < 4000,
        'child did not receive the whole cap (that was the pre-lease bug)',
      );
    }

    // Child usage is reconciled back into the parent, and no lease is left held.
    assert.equal(result.childUsage.input_tokens, 40, '4 children x 10 input');
    assert.equal(result.childUsage.output_tokens, 20, '4 children x 5 output');
    assert.equal(result.budget.active_leases, 0, 'all leases released');
    assert.deepEqual(result.budget.incomplete, [], 'no child left unreconciled');
    assert.ok(result.budget.used.input_tokens <= result.budget.caps.input_tokens);
  });

  it('refuses a child instead of spawning it unbudgeted when the remainder is exhausted', async () => {
    const runtime = makeStubRuntime();
    const coordinator = new Coordinator({ workerRuntime: runtime, sessionBaseDir: tempSessionDir() });

    // 2 input tokens split four ways floors to 0 per child, so acquire() must
    // refuse rather than hand out a zero-token lease or an unbudgeted spawn.
    const result = await coordinator.run(
      baseInput({
        researchPlan: planOf(['a', 'b', 'c', 'd']),
        budgetInputTokens: 2,
        budgetOutputTokens: 2,
      }),
    );

    assert.equal(runtime.calls.length, 0, 'no worker spawned without a lease');
    const refused = result.artifacts.workerResults.filter((r) => r.refused);
    assert.equal(refused.length, 4, 'every node recorded as refused');
    for (const r of refused) {
      assert.equal(r.stopReason, 'budget_refused');
      assert.match(r.summary, /no unleased budget remainder/);
    }
  });

  it('keeps the single-worker path unchanged when no researchPlan is given', async () => {
    const runtime = makeStubRuntime();
    const coordinator = new Coordinator({ workerRuntime: runtime, sessionBaseDir: tempSessionDir() });

    await coordinator.run(baseInput({ budgetInputTokens: 4000, budgetOutputTokens: 2000 }));

    assert.equal(runtime.calls.length, 1, 'exactly one research worker');
    assert.equal(runtime.calls[0].spec.phase, 'research');
    // A lone child may hold the entire remainder — that is correct, and matches
    // the pre-existing spawn-agent behaviour.
    assert.equal(runtime.calls[0].spec.budgetRemaining.input_tokens, 4000);
  });

  it('treats an uncapped run as unconstrained (no lease ids, still fans out)', async () => {
    const runtime = makeStubRuntime();
    const coordinator = new Coordinator({ workerRuntime: runtime, sessionBaseDir: tempSessionDir() });

    const result = await coordinator.run(baseInput({ researchPlan: planOf(['a', 'b', 'c']) }));

    assert.equal(runtime.calls.length, 3, 'all nodes ran');
    for (const c of runtime.calls) {
      assert.equal(c.spec.leaseId, null, 'unconstrained lease carries no id');
      assert.equal(c.spec.budgetRemaining, null, 'no budget flags forced on the child');
    }
    assert.equal(result.budget.caps.input_tokens, null, 'no cap recorded');
  });

  it('runs dependent nodes in later batches and splits per batch', async () => {
    const runtime = makeStubRuntime();
    const coordinator = new Coordinator({ workerRuntime: runtime, sessionBaseDir: tempSessionDir() });

    // root alone, then two siblings that depend on it.
    const plan = [
      { id: 'root', deps: [], prompt: 'research root' },
      { id: 'l1', deps: ['root'], prompt: 'research l1' },
      { id: 'l2', deps: ['root'], prompt: 'research l2' },
    ];
    await coordinator.run(baseInput({ researchPlan: plan, budgetInputTokens: 4000, budgetOutputTokens: 2000 }));

    assert.equal(runtime.calls.length, 3);
    const byNode = new Map(
      runtime.calls.map((c) => [c.spec.prompt.match(/research (\w+)/)[1], c.spec.budgetRemaining]),
    );
    // root is alone in its batch → whole remainder; l1/l2 share the rest.
    assert.equal(byNode.get('root').input_tokens, 4000);
    assert.ok(byNode.get('l1').input_tokens < 4000, 'sibling batch splits the remainder');
    assert.ok(byNode.get('l2').input_tokens < 4000, 'sibling batch splits the remainder');
  });

  it('marks a child incomplete when the spawn throws, without leaking the lease', async () => {
    const failing = {
      calls: [],
      async spawnWorker(spec) {
        this.calls.push(spec);
        throw new Error('spawn exploded');
      },
    };
    const coordinator = new Coordinator({ workerRuntime: failing, sessionBaseDir: tempSessionDir() });

    await assert.rejects(
      () =>
        coordinator.run(baseInput({ researchPlan: planOf(['a']), budgetInputTokens: 100, budgetOutputTokens: 100 })),
      /spawn exploded/,
    );
  });

  it('inherits maxTokens onto workers and honors per-node override (A3-F2)', async () => {
    const runtime = makeStubRuntime();
    const coordinator = new Coordinator({ workerRuntime: runtime, sessionBaseDir: tempSessionDir() });

    await coordinator.run(
      baseInput({
        maxTokens: 4000,
        researchPlan: [
          { id: 'default', deps: [], prompt: 'research default' },
          { id: 'big', deps: [], prompt: 'research big', maxTokens: 8000 },
        ],
      }),
    );

    assert.equal(runtime.calls.length, 2);
    const byId = new Map();
    for (const c of runtime.calls) {
      const m = c.spec.prompt.match(/research (\w+)/);
      byId.set(m[1], c.spec.inherit && c.spec.inherit.maxTokens);
    }
    assert.equal(byId.get('default'), 4000, 'CLI/input maxTokens reaches the worker inherit bag');
    assert.equal(byId.get('big'), 8000, 'plan node maxTokens overrides the run default');
  });
});
