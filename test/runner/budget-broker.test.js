'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBudgetBroker, parseCap } = require('../../src/runner/budget-broker');
const { createBudgetTracker } = require('../../src/runner/budget-tracker');
const spawnAgent = require('../../src/runner/tools/spawn-agent');

describe('budget broker (P1-05)', () => {
  it('distinguishes an absent cap from a real zero-token cap', () => {
    assert.equal(parseCap(null), null);
    assert.equal(parseCap(undefined), null);
    assert.equal(parseCap(''), null);
    assert.equal(parseCap(0), 0);
    assert.equal(parseCap('0'), 0);
  });

  it('leases remainder so a second acquire cannot copy the same tokens', () => {
    const broker = createBudgetBroker({ inputCap: 1000, outputCap: 500 });
    const usage = { input_tokens: 100, output_tokens: 50 };

    const first = broker.acquire(usage);
    assert.ok(first);
    assert.equal(first.input_tokens, 900);
    assert.equal(first.output_tokens, 450);
    assert.equal(broker.snapshot(usage).active_leases, 1);

    const second = broker.acquire(usage);
    assert.equal(second, null, 'second child cannot lease the same remainder');

    const released = broker.release(first.leaseId, { input_tokens: 200, output_tokens: 20 });
    assert.equal(released.reconciled, true);

    const after = { input_tokens: 300, output_tokens: 70 }; // parent folded child usage
    const third = broker.acquire(after);
    assert.ok(third);
    assert.equal(third.input_tokens, 700);
    assert.equal(third.output_tokens, 430);
  });

  it('marks incomplete when usage is missing on release', () => {
    const broker = createBudgetBroker({ inputCap: 100, outputCap: 100 });
    const lease = broker.acquire({ input_tokens: 0, output_tokens: 0 });
    const outcome = broker.release(lease.leaseId, null);
    assert.equal(outcome.reconciled, false);
    assert.equal(outcome.incomplete, true);
    assert.equal(broker.hasIncompleteChildren(), true);
  });

  it('is a no-op lease when run.js passes explicit null caps', () => {
    // run.js always creates a broker and passes the budget tracker's values.
    // With no CLI budget flags, those values are explicitly null—not omitted.
    const tracker = createBudgetTracker({});
    const broker = createBudgetBroker({
      inputCap: tracker.effectiveHardInput,
      outputCap: tracker.effectiveHardOutput,
    });
    const lease = broker.acquire({ input_tokens: 10, output_tokens: 10 });
    assert.equal(lease.unconstrained, true);
    assert.equal(lease.leaseId, null);
    assert.deepEqual(broker.snapshot().caps, {
      input_tokens: null,
      output_tokens: null,
    });
  });
});

describe('spawn_agent budget leasing (P1-05)', () => {
  it('acquires a lease, passes it to the worker, and reconciles child usage', async () => {
    const { createBudgetBroker: makeBroker } = require('../../src/runner/budget-broker');
    const broker = makeBroker({ inputCap: 1000, outputCap: 500 });
    let parentUsage = { input_tokens: 100, output_tokens: 40 };
    const calls = [];
    const fakeRuntime = {
      spawnWorker(spec) {
        calls.push(spec);
        return Promise.resolve({
          workerId: 'wrk_test',
          state: 'completed',
          phase: 'subagent',
          finalText: 'Child finished.',
          summary: 'Child finished.',
          exitCode: 0,
          stderr: '',
          duration_ms: 12,
          usage: { input_tokens: 80, output_tokens: 10 },
        });
      },
    };

    const ctx = {
      spawnDepth: 0,
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      workerRuntime: fakeRuntime,
      budgetBroker: broker,
      getParentUsage: () => parentUsage,
      reconcileChildUsage(leaseId, actualUsage) {
        const outcome = broker.release(leaseId, actualUsage);
        if (outcome.reconciled && outcome.usage) {
          parentUsage = {
            input_tokens: parentUsage.input_tokens + outcome.usage.input_tokens,
            output_tokens: parentUsage.output_tokens + outcome.usage.output_tokens,
          };
        }
        return outcome;
      },
    };

    const result = await spawnAgent.execute({ prompt: 'look around', max_steps: 3 }, ctx);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].budgetRemaining.input_tokens, 900);
    assert.equal(calls[0].budgetRemaining.output_tokens, 460);
    assert.ok(calls[0].leaseId);
    assert.equal(parentUsage.input_tokens, 180, 'child usage folded into parent');
    assert.equal(parentUsage.output_tokens, 50);
    assert.equal(broker.snapshot(parentUsage).active_leases, 0);
    assert.match(result.text, /budget_lease/);
    assert.match(result.text, /child_usage/);
  });

  it('refuses spawn when the parent budget has no unleased remainder', async () => {
    const broker = createBudgetBroker({ inputCap: 100, outputCap: 100 });
    // Exhaust with an active lease.
    broker.acquire({ input_tokens: 0, output_tokens: 0 });

    const result = await spawnAgent.execute(
      { prompt: 'look around' },
      {
        spawnDepth: 0,
        cwd: '/tmp',
        cwdRealpath: '/tmp',
        budgetBroker: broker,
        getParentUsage: () => ({ input_tokens: 0, output_tokens: 0 }),
        workerRuntime: {
          spawnWorker() {
            throw new Error('should not spawn');
          },
        },
      },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /no unleased remainder/);
  });

  it('allows sequential children when the parent has no explicit token caps', async () => {
    const broker = createBudgetBroker({ inputCap: null, outputCap: null });
    let parentUsage = { input_tokens: 20, output_tokens: 5 };
    const calls = [];
    const fakeRuntime = {
      async spawnWorker(spec) {
        calls.push(spec);
        return {
          workerId: 'wrk_unbounded_' + calls.length,
          state: 'completed',
          phase: 'subagent',
          finalText: 'Child finished.',
          summary: 'Child finished.',
          exitCode: 0,
          stderr: '',
          duration_ms: 5,
          usage: { input_tokens: 7, output_tokens: 3 },
        };
      },
    };
    const ctx = {
      spawnDepth: 0,
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      workerRuntime: fakeRuntime,
      budgetBroker: broker,
      getParentUsage: () => parentUsage,
      reconcileChildUsage(leaseId, actualUsage) {
        const outcome = broker.release(leaseId, actualUsage);
        if (outcome.reconciled && outcome.usage) {
          parentUsage = {
            input_tokens: parentUsage.input_tokens + outcome.usage.input_tokens,
            output_tokens: parentUsage.output_tokens + outcome.usage.output_tokens,
          };
        }
        return outcome;
      },
    };

    const first = await spawnAgent.execute({ prompt: 'first task' }, ctx);
    const second = await spawnAgent.execute({ prompt: 'second task' }, ctx);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].budgetRemaining, null);
    assert.equal(calls[1].budgetRemaining, null);
    assert.equal(calls[0].leaseId, null);
    assert.equal(calls[1].leaseId, null);
    assert.deepEqual(parentUsage, { input_tokens: 34, output_tokens: 11 });
  });

  it('allows simultaneous children when the parent has no explicit token caps', async () => {
    const broker = createBudgetBroker({ inputCap: null, outputCap: null });
    let parentUsage = { input_tokens: 0, output_tokens: 0 };
    let started = 0;
    let releaseChildren;
    const childrenMayFinish = new Promise((resolve) => {
      releaseChildren = resolve;
    });
    const fakeRuntime = {
      async spawnWorker(spec) {
        started += 1;
        assert.equal(spec.budgetRemaining, null);
        assert.equal(spec.leaseId, null);
        await childrenMayFinish;
        return {
          workerId: 'wrk_parallel_' + started,
          state: 'completed',
          phase: 'subagent',
          finalText: 'Child finished.',
          summary: 'Child finished.',
          exitCode: 0,
          stderr: '',
          duration_ms: 5,
          usage: { input_tokens: 4, output_tokens: 2 },
        };
      },
    };
    const ctx = {
      spawnDepth: 0,
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      workerRuntime: fakeRuntime,
      budgetBroker: broker,
      getParentUsage: () => parentUsage,
      reconcileChildUsage(leaseId, actualUsage) {
        const outcome = broker.release(leaseId, actualUsage);
        if (outcome.reconciled && outcome.usage) {
          parentUsage = {
            input_tokens: parentUsage.input_tokens + outcome.usage.input_tokens,
            output_tokens: parentUsage.output_tokens + outcome.usage.output_tokens,
          };
        }
        return outcome;
      },
    };

    const first = spawnAgent.execute({ prompt: 'first parallel task' }, ctx);
    const second = spawnAgent.execute({ prompt: 'second parallel task' }, ctx);
    // Both calls must reach the worker before either child is allowed to finish.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started, 2);
    releaseChildren();

    const results = await Promise.all([first, second]);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, true);
    assert.deepEqual(parentUsage, { input_tokens: 8, output_tokens: 4 });
  });

  it('still prevents simultaneous children from sharing one finite remainder', async () => {
    const broker = createBudgetBroker({ inputCap: 100, outputCap: 50 });
    let releaseFirst;
    const firstMayFinish = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let workerCalls = 0;
    const ctx = {
      spawnDepth: 0,
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      budgetBroker: broker,
      getParentUsage: () => ({ input_tokens: 0, output_tokens: 0 }),
      workerRuntime: {
        async spawnWorker() {
          workerCalls += 1;
          await firstMayFinish;
          return {
            workerId: 'wrk_finite',
            state: 'completed',
            phase: 'subagent',
            finalText: 'Child finished.',
            summary: 'Child finished.',
            exitCode: 0,
            stderr: '',
            duration_ms: 5,
            usage: { input_tokens: 10, output_tokens: 2 },
          };
        },
      },
      reconcileChildUsage(leaseId, actualUsage) {
        return broker.release(leaseId, actualUsage);
      },
    };

    const first = spawnAgent.execute({ prompt: 'lease the finite remainder' }, ctx);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await spawnAgent.execute({ prompt: 'try to reuse the remainder' }, ctx);

    assert.equal(second.ok, false);
    assert.match(second.text, /no unleased remainder/);
    assert.equal(workerCalls, 1);
    releaseFirst();
    assert.equal((await first).ok, true);
  });
});
