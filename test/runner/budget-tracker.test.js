'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const modelClient = require('../../src/runner/model-client');
const { run } = require('../../src/runner/run');
const { STOP_REASONS } = require('../../src/runner/kernel/contract');
const { createBudgetTracker } = require('../../src/runner/budget-tracker');

describe('budget-tracker', () => {
  it('emits soft warning before hard input cap', () => {
    const tracker = createBudgetTracker({ budgetInputTokens: 100, startedAt: Date.now() });
    const soft = tracker.evaluate({ input_tokens: 80, output_tokens: 0 }, { spawnDepth: 0, spawnCount: 0 });
    assert.equal(soft.stop, undefined);
    assert.equal(soft.warnings.length, 1);
    assert.equal(soft.event.type, 'budget');

    const hard = tracker.evaluate({ input_tokens: 100, output_tokens: 0 }, { spawnDepth: 0, spawnCount: 0 });
    assert.equal(hard.stop, STOP_REASONS.INPUT_TOKEN_BUDGET_EXCEEDED);
  });

  it('stops on hard output cap', () => {
    const tracker = createBudgetTracker({ budgetOutputTokens: 50, startedAt: Date.now() });
    const verdict = tracker.evaluate({ input_tokens: 0, output_tokens: 50 }, { spawnDepth: 1, spawnCount: 2 });
    assert.equal(verdict.stop, STOP_REASONS.OUTPUT_TOKEN_BUDGET_EXCEEDED);
    assert.equal(verdict.event.depth, 1);
    assert.equal(verdict.event.spawns, 2);
  });

  it('inherits parent remaining caps for child runs', () => {
    const tracker = createBudgetTracker({
      budgetInputTokens: 1000,
      parentRemaining: { input_tokens: 120, output_tokens: 80 },
      startedAt: Date.now(),
    });
    assert.equal(tracker.effectiveHardInput, 120);
    assert.equal(tracker.effectiveHardOutput, 80);
    const remaining = tracker.remainingAfterUsage({ input_tokens: 20, output_tokens: 10 });
    assert.equal(remaining.input_tokens, 100);
    assert.equal(remaining.output_tokens, 70);
  });
});

describe('run budget integration', () => {
  it('hard input token cap stops the run cleanly', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-run-'));
    const originalPost = modelClient.post;
    const savedExit = process.exitCode;
    modelClient.post = async () => ({
      content: [{ type: 'tool_use', id: 'tu1', name: 'list_files', input: { path: '.' } }],
      usage: { input_tokens: 60, output_tokens: 5 },
    });

    try {
      const result = await run({
        prompt: 'list files',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        bare: true,
        quiet: true,
        skipTrustGate: true,
        noArchive: true,
        noSessionPersistence: true,
        outputFormat: 'json',
        budgetInputTokens: 50,
      });
      assert.equal(result.stopReason, STOP_REASONS.INPUT_TOKEN_BUDGET_EXCEEDED);
      assert.ok(result.events.some((event) => event.type === 'budget'));
    } finally {
      modelClient.post = originalPost;
      process.exitCode = savedExit;
    }
  });

  it('soft cap emits budget_warning without stopping', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-soft-'));
    const originalPost = modelClient.post;
    let calls = 0;
    modelClient.post = async () => {
      calls++;
      if (calls === 1) {
        return {
          content: [{ type: 'tool_use', id: 'tu1', name: 'list_files', input: { path: '.' } }],
          usage: { input_tokens: 85, output_tokens: 2 },
        };
      }
      return {
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 5, output_tokens: 1 },
      };
    };

    try {
      const result = await run({
        prompt: 'list then answer',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        bare: true,
        quiet: true,
        skipTrustGate: true,
        noArchive: true,
        noSessionPersistence: true,
        outputFormat: 'json',
        budgetInputTokens: 100,
      });
      assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
      assert.ok(result.events.some((event) => event.type === 'budget_warning'));
    } finally {
      modelClient.post = originalPost;
    }
  });
});
