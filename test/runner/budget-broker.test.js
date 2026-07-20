'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBudgetBroker } = require('../../src/runner/budget-broker');
const spawnAgent = require('../../src/runner/tools/spawn-agent');

describe('budget broker (P1-05)', () => {
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

  it('is a no-op lease when no caps are set', () => {
    const broker = createBudgetBroker({});
    const lease = broker.acquire({ input_tokens: 10, output_tokens: 10 });
    assert.equal(lease.unconstrained, true);
    assert.equal(lease.leaseId, null);
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
});
