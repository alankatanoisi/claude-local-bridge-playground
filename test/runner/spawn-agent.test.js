'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const spawnAgent = require('../../src/runner/tools/spawn-agent');
const { getDefinitions } = require('../../src/runner/tool-registry');
const permissions = require('../../src/runner/permissions');

describe('spawn_agent tool', () => {
  it('is hidden when spawnDepth > 0', () => {
    const defs = getDefinitions({ spawnDepth: 1, cwd: '/tmp', cwdRealpath: '/tmp' });
    assert.ok(!defs.some((d) => d.name === 'spawn_agent'));
  });

  it('is visible at spawnDepth 0', () => {
    const defs = getDefinitions({ spawnDepth: 0, cwd: '/tmp', cwdRealpath: '/tmp' });
    assert.ok(defs.some((d) => d.name === 'spawn_agent'));
  });

  it('rejects spawn at depth > 0', async () => {
    const result = await spawnAgent.execute(
      { agent: 'explore', prompt: 'look around' },
      { spawnDepth: 1, cwd: '/tmp', cwdRealpath: '/tmp' },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /cannot spawn further children/i);
  });

  it('rejects unknown agent', async () => {
    const result = await spawnAgent.execute(
      { agent: 'not-a-real-agent', prompt: 'task' },
      { spawnDepth: 0, cwd: '/tmp', cwdRealpath: '/tmp' },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /Unknown agent/i);
  });

  it('delegates to WorkerRuntime and returns child output', async () => {
    const calls = [];
    const fakeRuntime = {
      spawnWorker(spec) {
        calls.push(spec);
        return Promise.resolve({
          workerId: 'wrk_test',
          state: 'completed',
          phase: 'subagent',
          finalText: 'Child finished.',
          summary: '[worker:subagent] Child finished.',
          exitCode: 0,
          stderr: '',
          duration_ms: 42,
        });
      },
    };

    const ctx = {
      spawnDepth: 0,
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      allowShell: false,
      acceptEdits: false,
      dontAsk: true,
      workerRuntime: fakeRuntime,
    };

    const result = await spawnAgent.execute({ agent: 'explore', prompt: 'Summarize src/runner/', max_steps: 4 }, ctx);

    assert.equal(result.ok, true);
    assert.match(result.text, /Child finished/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].agent, 'explore');
    assert.equal(calls[0].maxSteps, 4);
    assert.equal(calls[0].dontAsk, true);
    assert.equal(ctx.spawnCount, 1);
  });

  it('permissions deny spawn_agent for child depth', () => {
    const decision = permissions.check(
      'spawn_agent',
      { agent: 'explore', prompt: 'x' },
      { spawnDepth: 1, cwd: '/tmp', cwdRealpath: '/tmp' },
    );
    assert.equal(decision.decision, 'deny');
  });

  it('permissions ask by default at top level', () => {
    const decision = permissions.check(
      'spawn_agent',
      { agent: 'explore', prompt: 'x' },
      { spawnDepth: 0, cwd: '/tmp', cwdRealpath: '/tmp' },
    );
    assert.equal(decision.decision, 'ask');
  });
});
