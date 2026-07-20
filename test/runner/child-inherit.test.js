'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildChildInheritSpec,
  applyInheritToArgs,
  applyInheritToEnv,
  buildChildManifest,
} = require('../../src/runner/child-inherit');
const spawnAgent = require('../../src/runner/tools/spawn-agent');
const { WorkerRuntime } = require('../../src/runner/worker-runtime');

describe('child-inherit (P1-10)', () => {
  it('builds inherit bag from ctx.childInherit and live wall-clock remainder', () => {
    const inherit = buildChildInheritSpec(
      {
        noNetwork: true,
        childInherit: {
          model: 'claude-sonnet-4-6',
          effort: 'high',
          thinking: 'auto',
          bridgeUrl: 'http://127.0.0.1:11437/v1/messages',
          hasCallerToken: true,
          maxWallClockMs: 60_000,
          maxCostUsd: 1.5,
          temperature: 0.2,
          traceLevel: 'summary',
          parentRunId: 'run_abc',
        },
      },
      { maxWallClockMs: 12_000 },
    );
    assert.equal(inherit.model, 'claude-sonnet-4-6');
    assert.equal(inherit.effort, 'high');
    assert.equal(inherit.noNetwork, true);
    assert.equal(inherit.maxWallClockMs, 12_000, 'live remainder wins');
    assert.equal(inherit.parentRunId, 'run_abc');
    assert.equal(inherit.hasCallerToken, true);
  });

  it('applies inherit flags to argv without putting caller tokens on argv', () => {
    const args = ['bin.js'];
    applyInheritToArgs(args, {
      model: 'claude-sonnet-4-6',
      effort: 'medium',
      thinking: 'off',
      bridgeUrl: 'http://127.0.0.1:11437/v1/messages',
      noNetwork: true,
      maxWallClockMs: 5000,
      maxCostUsd: 0.5,
      temperature: 0,
      traceLevel: 'redacted',
      hasCallerToken: true,
    });
    const joined = args.join(' ');
    assert.match(joined, /--model claude-sonnet-4-6/);
    assert.match(joined, /--effort medium/);
    assert.match(joined, /--thinking off/);
    assert.match(joined, /--bridge-url /);
    assert.match(joined, /--no-network/);
    assert.match(joined, /--max-wall-clock-ms 5000/);
    assert.match(joined, /--max-cost-usd 0.5/);
    assert.match(joined, /--temperature 0/);
    assert.match(joined, /--trace-level redacted/);
    assert.doesNotMatch(joined, /caller-token|sk-|token=/i);
  });

  it('puts correlation ids and caller token only in env', () => {
    const env = applyInheritToEnv(
      {},
      { parentRunId: 'run_parent' },
      { workerId: 'wrk_1', callerToken: 'secret-token' },
    );
    assert.equal(env.BRIDGE_RUNNER_PARENT_RUN_ID, 'run_parent');
    assert.equal(env.BRIDGE_RUNNER_WORKER_ID, 'wrk_1');
    assert.equal(env.BRIDGE_CALLER_TOKEN, 'secret-token');
  });

  it('builds a child manifest with inherited ceilings and usage', () => {
    const manifest = buildChildManifest({
      workerResult: {
        workerId: 'wrk_x',
        phase: 'subagent',
        state: 'completed',
        stopReason: 'success',
        exitCode: 0,
        duration_ms: 42,
        usage: { input_tokens: 10, output_tokens: 5 },
        events: [{ type: 'tool_effect_result', tool: 'read_file', ok: true }],
        summary: 'done',
      },
      inherit: {
        model: 'claude-sonnet-4-6',
        bridgeUrl: 'http://127.0.0.1:11437/v1/messages',
        noNetwork: true,
        parentRunId: 'run_p',
        hasCallerToken: true,
      },
      leaseId: 'lease_1',
    });
    assert.equal(manifest.workerId, 'wrk_x');
    assert.equal(manifest.usage.input_tokens, 10);
    assert.equal(manifest.inherited.bridgeUrl, '[set]');
    assert.equal(manifest.inherited.hasCallerToken, true);
    assert.equal(manifest.leaseId, 'lease_1');
    assert.equal(manifest.toolEffects.length, 1);
  });
});

describe('spawn_agent inherit + manifest (P1-10)', () => {
  it('passes inherit into WorkerRuntime and records a child manifest', async () => {
    const calls = [];
    const fakeRuntime = {
      spawnWorker(spec, options) {
        calls.push({ spec, options });
        return Promise.resolve({
          workerId: 'wrk_test',
          state: 'completed',
          phase: 'subagent',
          finalText: 'Child finished.',
          summary: 'Child finished.',
          exitCode: 0,
          stderr: '',
          duration_ms: 9,
          usage: { input_tokens: 3, output_tokens: 1 },
          stopReason: 'success',
          events: [],
        });
      },
    };

    const ctx = {
      spawnDepth: 0,
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      workerRuntime: fakeRuntime,
      childInherit: {
        model: 'claude-sonnet-4-6',
        effort: 'high',
        bridgeUrl: 'http://127.0.0.1:11437/v1/messages',
        noNetwork: true,
        maxWallClockMs: 30_000,
        traceLevel: 'summary',
        parentRunId: 'run_parent',
        callerToken: 'tok',
        hasCallerToken: true,
      },
      runStartedAtMs: Date.now() - 1000,
      childManifests: [],
      recorded: [],
      recordChildManifest(m) {
        this.recorded.push(m);
      },
    };

    const result = await spawnAgent.execute({ prompt: 'Summarize README', max_steps: 2 }, ctx);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].spec.inherit.model, 'claude-sonnet-4-6');
    assert.equal(calls[0].spec.inherit.noNetwork, true);
    assert.equal(calls[0].spec.inherit.effort, 'high');
    assert.ok(calls[0].spec.inherit.maxWallClockMs < 30_000, 'remaining wall clock shrinks');
    assert.equal(calls[0].options.callerToken, 'tok');
    assert.equal(ctx.childManifests.length, 1);
    assert.equal(ctx.recorded.length, 1);
    assert.equal(result.childManifest.workerId, 'wrk_test');
  });
});

describe('WorkerRuntime argv inherit (P1-10)', () => {
  it('includes inherited flags on the child argv', async () => {
    const captured = [];
    const runtime = new WorkerRuntime({
      spawnDepth: 0,
      spawn(execPath, args, opts) {
        captured.push({ execPath, args, opts });
        // Fake child process that closes immediately with empty JSON.
        const { EventEmitter } = require('events');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({ finalText: 'ok', usage: { input_tokens: 1 } })));
          child.emit('close', 0);
        });
        return child;
      },
    });

    const result = await runtime.spawnWorker(
      {
        prompt: 'hi',
        cwd: process.cwd(),
        maxSteps: 2,
        allowedTools: ['read_file'],
        inherit: {
          model: 'claude-sonnet-4-6',
          effort: 'low',
          noNetwork: true,
          bridgeUrl: 'http://127.0.0.1:11437/v1/messages',
          traceLevel: 'summary',
          parentRunId: 'run_z',
        },
      },
      { callerToken: 'secret' },
    );

    assert.equal(captured.length, 1);
    const argv = captured[0].args.join(' ');
    assert.match(argv, /--model claude-sonnet-4-6/);
    assert.match(argv, /--effort low/);
    assert.match(argv, /--no-network/);
    assert.match(argv, /--bridge-url /);
    assert.match(argv, /--trace-level summary/);
    assert.equal(captured[0].opts.env.BRIDGE_CALLER_TOKEN, 'secret');
    assert.equal(captured[0].opts.env.BRIDGE_RUNNER_PARENT_RUN_ID, 'run_z');
    assert.ok(captured[0].opts.env.BRIDGE_RUNNER_WORKER_ID);
    assert.equal(result.usage.input_tokens, 1);
    assert.equal(result.inherited.model, 'claude-sonnet-4-6');
  });
});
