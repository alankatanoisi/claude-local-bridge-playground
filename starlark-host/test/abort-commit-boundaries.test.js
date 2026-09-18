'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { ClaudeBridge, CostBudget, MockBridge } = require('../src/bridge');
const { PhasedCoordinator } = require('../src/coordinator');
const { createDeterministicProvider } = require('../src/deterministic-analyst');
const { fixture } = require('./helpers/r11-fixture');

const eventsAt = (f) => fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const stateAt = (f) => JSON.parse(fs.readFileSync(path.join(f.runDir, 'state.json'), 'utf8'));
const terminal = (events) => events.filter((event) => ['job_failed', 'job_succeeded'].includes(event.type));

function host(f, bridge, controller, workerRegistry) {
  return new PhasedCoordinator({
    config: f.config,
    documents: f.documents,
    runDir: f.runDir,
    bridge,
    controller,
    workerRegistry,
    workerName: 'repo_file_analyst',
    plannerModel: 'claude-sonnet-5',
    workerModel: 'claude-sonnet-5',
    planSource: 'host_json',
    faultProfile: 'none',
  });
}

// Only the provider response is fake. Requests travel over a real loopback
// socket through ClaudeBridge, pricing, budget settlement and the real host.
async function setup(t, { invalid = false, settlementError = null, concurrency = 1 } = {}) {
  const f = fixture();
  f.config.maxConcurrency = concurrency;
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  let requests = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    requests += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        content: [
          {
            type: 'text',
            text: invalid
              ? 'not valid JSON'
              : JSON.stringify({ summary: 'local fixture', claims: [], evidence: [], confidence: 0.5 }),
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const budget = new CostBudget(1);
  const settle = budget.settle.bind(budget);
  budget.settle = async (id, entry) => {
    settle(id, entry);
    // This boundary is controlled by execution order, not by a timer race.
    controller.abort(new Error('cancel at settlement boundary'));
    if (settlementError) throw settlementError;
  };
  const bridge = new ClaudeBridge({
    runnerRepo: path.resolve(__dirname, '../..'),
    budget,
    bridgeUrl: `http://127.0.0.1:${server.address().port}/v1/messages`,
  });
  return { f, controller, budget, bridge, requests: () => requests };
}

test('abort-commit: settled invalid output records one charged failure and resume uses explicit recovery', async (t) => {
  const { f, controller, budget, bridge, requests } = await setup(t, { invalid: true });
  const state = await host(f, bridge, controller).run();
  const before = eventsAt(f);
  const receipts = terminal(before);
  assert.equal(requests(), 1);
  assert.equal(budget.calls.length, 1);
  assert.ok(budget.usedUsd > 0);
  assert.equal(budget.reservedUsd, 0);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].type, 'job_failed');
  assert.equal(receipts[0].payload.error.code, 'invalid_worker_output');
  assert.equal(receipts[0].payload.charged, true);
  assert.equal(state.phase, 'aborted');
  assert.equal(stateAt(f).results.length, 1);
  assert.equal(stateAt(f).results[0].ok, false);
  assert.deepEqual(stateAt(f).cost, budget.toJSON());
  assert.equal(before.at(-1).type, 'run_aborted');
  assert.equal(before.filter((event) => event.type === 'run_aborted').length, 1);
  assert.equal(before.filter((event) => event.type === 'job_started').length, 1);
  const failedId = receipts[0].payload.jobId;
  const prefix = fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8');
  const labels = [];
  const provider = createDeterministicProvider();
  const resumed = await host(f, new MockBridge({ budget: new CostBudget(0) }), new AbortController(), {
    publicProfiles: () => [],
    execute(request) {
      labels.push(request.label);
      return provider.execute(request);
    },
  }).run({ resume: true });
  const after = eventsAt(f);
  assert.equal(resumed.phase, 'completed');
  assert.equal(labels.filter((label) => label.startsWith(`worker:${failedId}:`)).length, 0);
  const recovery = after.find((event) => event.type === 'recovery_plan_validated').payload.jobs;
  const retry = recovery.find((job) => job.retry_of === failedId);
  assert.ok(retry, 'existing recovery policy explicitly links a new retry to the failed job');
  assert.equal(labels.filter((label) => label.startsWith(`worker:${retry.id}:`)).length, 1);
  assert.equal(terminal(after).filter((event) => event.payload.jobId === failedId).length, 1);
  assert.equal(new Set(terminal(after).map((event) => event.payload.jobId)).size, terminal(after).length);
  assert.ok(fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8').startsWith(prefix));
  assert.equal(budget.calls.length, 1);
});

for (const boundary of ['artifact', 'checkpoint', 'settlement']) {
  test(`abort-commit: ${boundary} failure remains visible during cancellation`, async (t) => {
    const injected = Object.assign(new Error(`injected ${boundary} failure`), { code: 'EIO' });
    const { f, controller, budget, bridge } = await setup(t, {
      settlementError: boundary === 'settlement' ? injected : null,
    });
    const coordinator = host(f, bridge, controller);
    if (boundary === 'artifact') {
      const write = coordinator.ledger.writeArtifact.bind(coordinator.ledger);
      coordinator.ledger.writeArtifact = (name, value) => {
        // Input snapshots still use the real ledger. Fail only the worker artifact.
        if (name.endsWith('-attempt-1')) throw injected;
        return write(name, value);
      };
    }
    if (boundary === 'checkpoint') {
      const checkpoint = coordinator.ledger.checkpoint.bind(coordinator.ledger);
      coordinator.ledger.checkpoint = (state) => {
        if (state.phase === 'aborted') throw injected;
        return checkpoint(state);
      };
    }
    await assert.rejects(coordinator.run(), (error) => error === injected);
    const events = eventsAt(f);
    assert.equal(budget.calls.length, 1);
    assert.equal(budget.reservedUsd, 0);
    assert.equal(events.filter((event) => event.type === 'job_started').length, 1);
    assert.equal(
      events.filter((event) => event.type === 'job_failed').length,
      0,
      'infrastructure failure is not invalid model output',
    );
    assert.equal(events.filter((event) => event.type === 'run_completed').length, 0);
    assert.equal(events.filter((event) => event.type === 'job_succeeded').length, boundary === 'checkpoint' ? 1 : 0);
  });
}

// Make slot zero cancel first and slot one fail afterward. The pool must drain
// both promises and select the real failure even though cancellation came first.
test('abort-commit: sibling cancellation cannot mask a drained worker persistence failure', async (t) => {
  const f = fixture();
  f.config.maxConcurrency = 2;
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  const injected = new Error('injected concurrent artifact failure');
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let drained = false;
  const coordinator = host(f, new MockBridge({ budget: new CostBudget(0) }), controller, {
    publicProfiles: () => [],
    async execute() {
      calls += 1;
      if (calls === 1) {
        await barrier;
        throw controller.signal.reason;
      }
      controller.abort(new Error('cancel sibling'));
      release();
      // An already completed response may still need its artifact persisted.
      return {
        text: JSON.stringify({ summary: 'done', claims: [], evidence: [], confidence: 0.5 }),
        usage: {},
        costUsd: 0,
      };
    },
  });
  const write = coordinator.ledger.writeArtifact.bind(coordinator.ledger);
  coordinator.ledger.writeArtifact = (name, value) => {
    if (name.endsWith('-attempt-1')) {
      drained = true;
      throw injected;
    }
    return write(name, value);
  };
  await assert.rejects(coordinator.run(), (error) => error === injected);
  assert.equal(drained, true);
  assert.equal(calls, 2);
  assert.equal(terminal(eventsAt(f)).length, 0);
});

// A phase checkpoint can fail while the same callback observes cancellation.
// This exercises the outer run catch directly, before any network work starts.
test('abort-commit: phase checkpoint error is not replaced by clean cancellation', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  const injected = new Error('injected workers checkpoint failure');
  const coordinator = host(f, new MockBridge({ budget: new CostBudget(0) }), controller);
  const checkpoint = coordinator.ledger.checkpoint.bind(coordinator.ledger);
  coordinator.ledger.checkpoint = (state) => {
    if (state.phase === 'workers') {
      controller.abort(new Error('cancel while checkpointing'));
      throw injected;
    }
    return checkpoint(state);
  };
  await assert.rejects(coordinator.run(), (error) => error === injected);
  assert.equal(eventsAt(f).filter((event) => event.type === 'job_started').length, 0);
});
