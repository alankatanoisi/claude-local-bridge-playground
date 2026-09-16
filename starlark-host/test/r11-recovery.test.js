'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { ClaudeBridge, CostBudget, MockBridge } = require('../src/bridge');
const { openCampaignBudget } = require('../src/campaign-budget');
const { PhasedCoordinator } = require('../src/coordinator');
const { createDeterministicProvider } = require('../src/deterministic-analyst');
const { fixture } = require('./helpers/r11-fixture');

const HOST = path.resolve(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const eventsAt = (runDir) =>
  fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

// Evaluate every named invariant, then report all failures together. One bad
// artifact must not hide an independent accounting or duplicate-job problem.
function predicates(checks) {
  const failures = [];
  for (const [name, check] of Object.entries(checks)) {
    try {
      check();
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], 'terminal-state predicates');
}

async function budgetFor(f) {
  return openCampaignBudget({ dir: path.join(f.root, 'campaigns'), campaignId: 'mock-r11', limitUsd: 1 });
}

function coordinator(f, bridge, controller, workerRegistry) {
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

function abortChecks(runDir, budget) {
  const events = eventsAt(runDir);
  const abort = events.find((event) => event.type === 'run_aborted');
  return {
    'abort receipt has a reason': () => assert.ok(abort?.payload.reason),
    'no job starts or results after abort': () =>
      assert.ok(
        events.every(
          (event) => event.seq <= abort.seq || !['job_started', 'job_succeeded', 'job_failed'].includes(event.type),
        ),
      ),
    'run_aborted is the final ledger event (recorded after the pool drained)': () =>
      assert.equal(events[events.length - 1].type, 'run_aborted'),
    'checkpoint is recognizable as aborted': () => assert.equal(read(path.join(runDir, 'state.json')).phase, 'aborted'),
    'abort checkpoint carries every landed success': () =>
      assert.equal(
        read(path.join(runDir, 'state.json')).results.filter((result) => result.ok).length,
        events.filter((event) => event.type === 'job_succeeded').length,
      ),
    'every ledger line is parseable': () => assert.ok(eventsAt(runDir).length > 0),
    'no duplicate terminal job receipt': () => {
      const ids = events
        .filter((event) => ['job_succeeded', 'job_failed'].includes(event.type))
        .map((event) => event.payload.jobId);
      assert.equal(new Set(ids).size, ids.length);
    },
    'campaign ledger is parseable': () =>
      fs
        .readFileSync(budget.ledgerPath, 'utf8')
        .trim()
        .split('\n')
        .forEach((line) => JSON.parse(line)),
    'campaign has no stranded reservation': () => assert.equal(budget.reservedUsd, 0),
    'mock campaign spend is zero': () => assert.equal(budget.usedUsd, 0),
  };
}

// Abort-commit protocol (thermo-nuclear Mediums #1 + #2). A provider that has
// already RETURNED a result was paid for it, so that result must land as a
// receipt even though the run is aborting; what abort guarantees is that no
// NEW job starts and that `run_aborted` is written only after every in-flight
// worker has settled. Resume then reuses those receipts instead of paying again.
test('R11 cooperative abort: in-flight completions land receipts, run_aborted follows the drain, resume reuses them', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const budget = await budgetFor(f);
  const controller = new AbortController();
  const real = createDeterministicProvider();
  const labels = [];
  let active = 0;
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const workerRegistry = {
    publicProfiles: () => [],
    async execute(request) {
      labels.push(request.label);
      active += 1;
      if (active === 3) ready();
      // Deliberately ignore cancellation, reproducing a provider's late callback.
      await delay(50);
      return real.execute({ ...request, signal: undefined });
    },
  };
  const run = coordinator(f, new MockBridge({ budget }), controller, workerRegistry).run();
  await started;
  controller.abort(new Error('test cooperative abort'));
  await run;
  const events = eventsAt(f.runDir);
  const succeeded = events.filter((event) => event.type === 'job_succeeded').map((event) => event.payload.jobId);
  predicates({
    ...abortChecks(f.runDir, budget),
    'exactly the three in-flight jobs started': () =>
      assert.equal(events.filter((event) => event.type === 'job_started').length, 3),
    'each in-flight completion landed a success receipt': () => assert.equal(succeeded.length, 3),
  });

  const resumedLabels = [];
  const resumed = coordinator(f, new MockBridge({ budget }), new AbortController(), {
    publicProfiles: () => [],
    async execute(request) {
      resumedLabels.push(request.label);
      return real.execute(request);
    },
  });
  const state = await resumed.run({ resume: true });
  const plan = events.find((event) => event.type === 'plan_validated').payload.jobs;
  predicates({
    'resume completed': () => assert.equal(state.phase, 'completed'),
    'landed receipts were not executed again': () => {
      for (const id of succeeded)
        assert.equal(resumedLabels.filter((label) => label.startsWith(`worker:${id}:`)).length, 0, id);
    },
    'every other planned job executed exactly once on resume': () => {
      for (const job of plan.filter((job) => !succeeded.includes(job.id)))
        assert.equal(resumedLabels.filter((label) => label.startsWith(`worker:${job.id}:`)).length, 1, job.id);
    },
    'one terminal success per planned job across both segments': () => {
      const all = eventsAt(f.runDir);
      for (const job of plan)
        assert.equal(
          all.filter((event) => event.type === 'job_succeeded' && event.payload.jobId === job.id).length,
          1,
          job.id,
        );
    },
  });
});

// Medium #1, exact window: the bridge has settled the reservation (the call is
// charged) and THEN the run is aborted. The charged result must still become a
// job_succeeded receipt, and resume must not call the bridge for that job.
test('R11 settled-then-aborted bridge call persists its receipt and is not re-bought on resume', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  const workerJson = JSON.stringify({
    summary: 'paid worker answer',
    claims: ['settled before abort'],
    evidence: ['local http fixture'],
    confidence: 0.9,
  });
  const server = http.createServer((request, response) => {
    request.resume();
    // Long enough that all three pool slots are genuinely in flight together.
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'req_settled' });
      response.end(
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: workerJson }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
      );
    }, 60);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  // The abort fires INSIDE settle(): after the response body is in memory and
  // the cost is recorded, before ClaudeBridge.call returns.
  class AbortOnFirstSettle extends CostBudget {
    settle(id, entry) {
      super.settle(id, entry);
      if (!controller.signal.aborted) controller.abort(new Error('abort after settle'));
    }
  }
  const budget = new AbortOnFirstSettle(5);
  const bridge = new ClaudeBridge({
    runnerRepo: path.resolve(HOST, '..'),
    budget,
    bridgeUrl: `http://127.0.0.1:${server.address().port}/v1/messages`,
  });
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));
  await coordinator(f, bridge, controller).run();
  const events = eventsAt(f.runDir);
  const succeeded = events.filter((event) => event.type === 'job_succeeded').map((event) => event.payload.jobId);
  predicates({
    'exactly one call was charged': () => assert.equal(budget.calls.length, 1),
    'the charged call landed a success receipt': () => assert.equal(succeeded.length, 1),
    'no reservation is stranded': () => assert.equal(budget.reservedUsd, 0),
    'run_aborted is the final event': () => assert.equal(events[events.length - 1].type, 'run_aborted'),
    'checkpoint is aborted and lists the paid success': () => {
      const state = read(path.join(f.runDir, 'state.json'));
      assert.equal(state.phase, 'aborted');
      assert.equal(state.results.filter((result) => result.ok).length, 1);
    },
    'no unhandled rejection': () => assert.deepEqual(unhandled, []),
  });

  const resumedLabels = [];
  const real = createDeterministicProvider();
  const resumed = coordinator(f, new MockBridge({ budget: new CostBudget(0) }), new AbortController(), {
    publicProfiles: () => [],
    async execute(request) {
      resumedLabels.push(request.label);
      return real.execute(request);
    },
  });
  const state = await resumed.run({ resume: true });
  const plan = events.find((event) => event.type === 'plan_validated').payload.jobs;
  predicates({
    'resume completed': () => assert.equal(state.phase, 'completed'),
    'the paid job was not executed again': () =>
      assert.equal(resumedLabels.filter((label) => label.startsWith(`worker:${succeeded[0]}:`)).length, 0),
    'interrupted and unstarted jobs each executed once': () => {
      for (const job of plan.filter((job) => job.id !== succeeded[0]))
        assert.equal(resumedLabels.filter((label) => label.startsWith(`worker:${job.id}:`)).length, 1, job.id);
    },
    'the paid call is still the only charged call in the original ledger': () => assert.equal(budget.calls.length, 1),
  });
});

// Medium #3 companion: if the `completed` checkpoint is lost (state.json one
// step behind events.jsonl), a recorded run_completed must still make resume
// a no-op — no bridge call, no new events.
test('R11 resume treats run_completed in the event log as authoritative over a stale checkpoint', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const real = createDeterministicProvider();
  const registry = { publicProfiles: () => [], execute: (request) => real.execute(request) };
  await coordinator(f, new MockBridge({ budget: new CostBudget(0) }), new AbortController(), registry).run();
  const statePath = path.join(f.runDir, 'state.json');
  const completed = read(statePath);
  // Simulate the lost final checkpoint: roll state.json back to the synthesis
  // phase while events.jsonl (fsync'd per line) still ends with run_completed.
  fs.writeFileSync(statePath, JSON.stringify({ ...completed, phase: 'synthesis', synthesis: null }));
  const before = fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8');
  const forbidden = {
    budget: new CostBudget(0),
    async call() {
      throw new Error('resume of a completed run must not call the bridge');
    },
  };
  const state = await coordinator(f, forbidden, new AbortController(), {
    publicProfiles: () => [],
    async execute() {
      throw new Error('resume of a completed run must not execute workers');
    },
  }).run({ resume: true });
  predicates({
    'phase is completed': () => assert.equal(state.phase, 'completed'),
    'checkpoint was repaired to completed': () => assert.equal(read(statePath).phase, 'completed'),
    'synthesis text survived via result.json': () => assert.equal(state.synthesis, completed.synthesis),
    'event log is byte-identical': () =>
      assert.equal(fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8'), before),
  });
});

test('R11 cancel under concurrency: HTTP requests are destroyed and budgets drain', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const budget = await budgetFor(f);
  let inFlight = 0;
  let peak = 0;
  let closed = 0;
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const timers = [];
  const server = http.createServer((request, response) => {
    request.resume();
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    response.on('close', () => {
      closed += 1;
      inFlight -= 1;
    });
    // Staggered, outstanding responses: abort must close the actual sockets.
    timers.push(setTimeout(() => response.end('{}'), 5000 + peak * 100));
    if (peak === 3) ready();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    timers.forEach(clearTimeout);
    server.closeAllConnections();
    server.close();
  });
  const controller = new AbortController();
  const bridge = new ClaudeBridge({
    runnerRepo: path.resolve(HOST, '..'),
    budget,
    bridgeUrl: `http://127.0.0.1:${server.address().port}/v1/messages`,
  });
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));
  const run = coordinator(f, bridge, controller).run();
  await started;
  controller.abort(new Error('test concurrent abort'));
  await run;
  // Let the local server observe the already-destroyed client sockets.
  for (let tries = 0; closed < 3 && tries < 100; tries += 1) await delay(10);
  predicates({
    ...abortChecks(f.runDir, budget),
    'at least three calls were genuinely in flight': () => assert.ok(peak >= 3),
    'all aborted request sockets closed': () => assert.equal(closed, 3),
    'no unhandled rejection': () => assert.deepEqual(unhandled, []),
  });
});

function child(f, args, { fast = false, entry = 'run-workflow.js' } = {}) {
  const proc = spawn(
    process.execPath,
    ['--require', path.join(__dirname, 'helpers/r11-child-preload.js'), path.join(HOST, 'bin', entry), ...args],
    {
      env: { ...process.env, R11_FIXTURE: f.fixturePath, ...(fast ? { R11_FAST: '1' } : {}) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  let stderr = '';
  let stdout = '';
  proc.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  proc.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code, signal) => resolve({ code, signal, stderr, stdout }));
  });
  return { proc, exited };
}

async function interrupted(t, signal) {
  const f = fixture();
  const running = child(f, [
    '--mode',
    'mock',
    '--plan-source',
    'host_json',
    '--worker-provider',
    'deterministic_analyst',
  ]);
  t.after(async () => {
    // Kill ONLY the child we created, never a process discovered by name.
    if (running.proc.exitCode === null && running.proc.signalCode === null) running.proc.kill('SIGKILL');
    await running.exited;
    fs.rmSync(f.root, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child did not reach interruption rendezvous')), 15000);
    running.proc.once('message', () => {
      clearTimeout(timer);
      resolve();
    });
    running.exited.then((result) => {
      clearTimeout(timer);
      reject(new Error(`child exited early: ${result.stderr}`));
    });
  });
  const runDir = path.join(f.root, 'runs', fs.readdirSync(path.join(f.root, 'runs'))[0]);
  // This read arranges the interruption and identifies which jobs were already
  // durable; assertions below inspect only the final combined evidence.
  const before = eventsAt(runDir);
  const completed = before.filter((event) => event.type === 'job_succeeded').map((event) => event.payload.jobId);
  const unfinished = before
    .filter((event) => event.type === 'job_started' && !completed.includes(event.payload.jobId))
    .map((event) => event.payload.jobId);
  running.proc.kill(signal);
  const killed = await running.exited;
  const prefix = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  const resumed = child(f, ['--resume', runDir], { fast: true });
  t.after(() => {
    if (resumed.proc.exitCode === null && resumed.proc.signalCode === null) resumed.proc.kill('SIGKILL');
  });
  const result = await resumed.exited;
  const events = eventsAt(runDir);
  const plan = events.find((event) => event.type === 'plan_validated').payload.jobs;
  const executions = fs
    .readdirSync(path.join(f.root, 'executions'))
    .map((file) => read(path.join(f.root, 'executions', file)).label);
  predicates({
    'resume exits cleanly': () => assert.equal(result.code, 0, result.stderr),
    'child was interrupted with requested signal': () =>
      signal === 'SIGKILL'
        ? assert.equal(killed.signal, signal)
        : assert.equal(killed.code, signal === 'SIGINT' ? 130 : 143),
    'completed and interrupted jobs were both exercised': () => {
      assert.ok(completed.length > 0);
      assert.ok(unfinished.length > 0);
    },
    'each planned job has exactly one terminal success': () => {
      for (const job of plan)
        assert.equal(
          events.filter((event) => event.type === 'job_succeeded' && event.payload.jobId === job.id).length,
          1,
          job.id,
        );
    },
    'completed jobs were not executed again': () => {
      for (const id of completed)
        assert.equal(executions.filter((label) => label.startsWith(`worker:${id}:`)).length, 1, id);
    },
    'interrupted jobs executed again at least once': () => {
      for (const id of unfinished)
        assert.equal(executions.filter((label) => label.startsWith(`worker:${id}:`)).length, 2, id);
    },
    'previously unstarted jobs execute once': () => {
      for (const job of plan.filter((job) => !completed.includes(job.id) && !unfinished.includes(job.id))) {
        assert.equal(executions.filter((label) => label.startsWith(`worker:${job.id}:`)).length, 1, job.id);
      }
    },
    'ledger history remains byte-identical before resume': () =>
      assert.ok(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').startsWith(prefix)),
    'sequence strictly increases across resume': () =>
      assert.ok(events.every((event, index) => !index || event.seq > events[index - 1].seq)),
    'synthesis artifact references every job': () =>
      assert.deepEqual(
        read(path.join(runDir, 'artifacts/synthesis.json')).jobIds.sort(),
        plan.map((job) => job.id).sort(),
      ),
    'final checkpoint is completed': () => assert.equal(read(path.join(runDir, 'state.json')).phase, 'completed'),
    'budget file is consistent and costs zero': () => {
      const budget = read(path.join(f.root, 'budget.json'));
      assert.equal(budget.usedUsd, 0);
      assert.equal(budget.reservedUsd, 0);
    },
    'no unhandled rejection in either segment': () => assert.doesNotMatch(killed.stderr + result.stderr, /unhandled/i),
    'SIGTERM has an abort receipt': () => {
      if (signal === 'SIGTERM') assert.ok(events.some((event) => event.type === 'run_aborted'));
    },
  });
  return { f, runDir };
}

test('R11 process kill SIGTERM + resume', { timeout: 25000 }, async (t) => {
  await interrupted(t, 'SIGTERM');
});
test('R11 process interrupt SIGINT + resume', { timeout: 25000 }, async (t) => {
  await interrupted(t, 'SIGINT');
});

test('R11 process kill SIGKILL + resume', { timeout: 25000 }, async (t) => {
  await interrupted(t, 'SIGKILL');
});

test('R11 resume is idempotent through both command-line entry points', { timeout: 25000 }, async (t) => {
  const { f, runDir } = await interrupted(t, 'SIGTERM');
  const original = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  const outcomes = [];
  for (const entry of ['run-workflow.js', 'run-experiment.js']) {
    outcomes.push(await child(f, ['--resume', runDir], { fast: true, entry }).exited);
  }
  predicates({
    'completed resumes exit cleanly': () => outcomes.forEach((result) => assert.equal(result.code, 0, result.stderr)),
    'zero new job_started events or other ledger mutations': () =>
      assert.equal(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'), original),
  });
});

test('R11 recovery-phase interruption reuses failures, successes, and original input bytes', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const budget = await budgetFor(f);
  const controller = new AbortController();
  const real = createDeterministicProvider();
  const calls = [];
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const registry = {
    publicProfiles: () => [],
    async execute(request) {
      calls.push(request.label);
      if (request.label.includes(':attempt:2')) {
        ready();
        await delay(100, undefined, { signal: request.signal });
      }
      return real.execute(request);
    },
  };
  const original = coordinator(f, new MockBridge({ budget }), controller, registry);
  original.faults = new (require('../src/failures').FaultInjector)('mixed');
  const running = original.run();
  await started;
  controller.abort(new Error('interrupt recovery workers'));
  await running;
  const prior = eventsAt(f.runDir);
  const finishedIds = prior
    .filter((event) => ['job_succeeded', 'job_failed'].includes(event.type))
    .map((event) => event.payload.jobId);
  const initialCalls = [...calls];
  // Remove the source entirely. Resume must use saved input artifacts.
  fs.rmSync(f.config.targetRoot, { recursive: true });
  const resumed = coordinator(f, new MockBridge({ budget }), new AbortController(), {
    publicProfiles: () => [],
    async execute(request) {
      calls.push(request.label);
      return real.execute(request);
    },
  });
  await resumed.run({ resume: true });
  const events = eventsAt(f.runDir);
  predicates({
    'recovery resume completed without source files': () =>
      assert.equal(read(path.join(f.runDir, 'state.json')).phase, 'completed'),
    'previously terminal jobs never executed again': () => {
      for (const id of finishedIds)
        assert.equal(
          calls.filter((label) => label.startsWith(`worker:${id}:`)).length,
          initialCalls.filter((label) => label.startsWith(`worker:${id}:`)).length,
          id,
        );
    },
    'accepted recovery plan has one success per retry': () => {
      const jobs = events.find((event) => event.type === 'recovery_plan_validated').payload.jobs;
      for (const job of jobs)
        assert.equal(
          events.filter((event) => event.type === 'job_succeeded' && event.payload.jobId === job.id).length,
          1,
          job.id,
        );
    },
    'no duplicate terminal receipt across either phase': () => {
      const ids = events
        .filter((event) => ['job_succeeded', 'job_failed'].includes(event.type))
        .map((event) => event.payload.jobId);
      assert.equal(new Set(ids).size, ids.length);
    },
  });
});

// Medium #4: resume dispatches on what the ledger says is left. A run aborted
// DURING synthesis has every worker receipt on disk, so resume must go straight
// to synthesis — no planning or workers checkpoint, no job_started, one
// synthesis purchase — and the ledger must say so in worker_resume_started.
test('R11 abort during synthesis resumes into synthesis only, without replaying earlier phases', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const real = createDeterministicProvider();
  const registry = { publicProfiles: () => [], execute: (request) => real.execute(request) };
  const controller = new AbortController();
  const mock = new MockBridge({ budget: new CostBudget(0) });
  const blockingBridge = {
    budget: mock.budget,
    async call(request) {
      if (request.label.startsWith('synthesize')) {
        // The synthesis request is in flight; interrupt the run here.
        controller.abort(new Error('abort during synthesis'));
        await delay(1000, undefined, { signal: request.signal });
      }
      return mock.call(request);
    },
  };
  const aborted = await coordinator(f, blockingBridge, controller, registry).run();
  const before = eventsAt(f.runDir);
  predicates({
    'run is aborted with synthesis as the interrupted phase': () => {
      assert.equal(aborted.phase, 'aborted');
      assert.equal(before.find((event) => event.type === 'run_aborted').payload.interruptedPhase, 'synthesis');
    },
    'every planned job already has a success receipt': () =>
      assert.equal(before.filter((event) => event.type === 'job_succeeded').length, 6),
  });

  const synthesisCalls = [];
  const phases = [];
  const resumeBridge = {
    budget: new CostBudget(0),
    async call(request) {
      synthesisCalls.push(request.label);
      return mock.call(request);
    },
  };
  const resumed = coordinator(f, resumeBridge, new AbortController(), {
    publicProfiles: () => [],
    async execute() {
      throw new Error('no worker may run when every receipt is recorded');
    },
  });
  const originalCheckpoint = resumed.checkpoint.bind(resumed);
  resumed.checkpoint = () => {
    phases.push(resumed.state.phase);
    originalCheckpoint();
  };
  const state = await resumed.run({ resume: true });
  const events = eventsAt(f.runDir);
  const resumeStart = events.find((event) => event.type === 'worker_resume_started');
  predicates({
    'resume completed': () => assert.equal(state.phase, 'completed'),
    'ledger records that nothing but synthesis was left': () =>
      assert.deepEqual(resumeStart.payload.remaining, { plan: 0, recovery: null, synthesis: true }),
    'checkpoints went synthesis -> completed only (no planning/workers replay)': () =>
      assert.deepEqual(phases, ['synthesis', 'completed']),
    'no job started after resume': () =>
      assert.ok(!events.some((event) => event.seq > resumeStart.seq && event.type === 'job_started')),
    'exactly one synthesis call was made on resume': () =>
      assert.deepEqual(synthesisCalls, ['synthesize:claude-sonnet-5']),
    'result carries all six worker results': () => assert.equal(state.results.filter((result) => result.ok).length, 6),
  });
});

// Codex's 2026-09-16 handoff (§6) warned that run_completed is ALSO written
// with synthesisOk: false when synthesis FAILED after every worker was paid
// for. A stale checkpoint must not let that event name promote the run to
// "completed": the right answer is a repaired PARTIAL checkpoint that
// resume-synthesis.js can act on, with no bridge call and no worker re-run.
test('R11 resume keeps a run partial when run_completed says synthesisOk:false behind a stale checkpoint', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const real = createDeterministicProvider();
  const registry = { publicProfiles: () => [], execute: (request) => real.execute(request) };
  // The usual mock, except the synthesis call comes back truncated.
  class TruncatedSynthesisBridge extends MockBridge {
    async call(request) {
      const response = await super.call(request);
      return request.label.startsWith('synthesize:') ? { ...response, rawStopReason: 'max_tokens' } : response;
    }
  }
  const first = await coordinator(
    f,
    new TruncatedSynthesisBridge({ budget: new CostBudget(0) }),
    new AbortController(),
    registry,
  ).run();
  assert.equal(first.phase, 'partial');
  assert.equal(first.synthesisFailure?.code, 'truncated_synthesis');
  const statePath = path.join(f.runDir, 'state.json');
  const partial = read(statePath);
  // Lose the final checkpoint: state.json says we are mid-synthesis while
  // events.jsonl (fsync'd per line) ends with run_completed { synthesisOk: false }.
  fs.writeFileSync(
    statePath,
    JSON.stringify({ ...partial, phase: 'synthesis', synthesis: null, synthesisFailure: null }),
  );
  const before = fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8');
  const forbidden = {
    budget: new CostBudget(0),
    async call() {
      throw new Error('resume of a partial run must not call the bridge');
    },
  };
  const forbiddenRegistry = {
    publicProfiles: () => [],
    async execute() {
      throw new Error('resume of a partial run must not execute workers');
    },
  };
  await assert.rejects(
    coordinator(f, forbidden, new AbortController(), forbiddenRegistry).run({ resume: true }),
    /use resume-synthesis/,
  );
  const repaired = read(statePath);
  predicates({
    'checkpoint was repaired to partial, not completed': () => assert.equal(repaired.phase, 'partial'),
    'synthesis failure survived via result.json': () =>
      assert.deepEqual(repaired.synthesisFailure, partial.synthesisFailure),
    'worker results survived': () => assert.equal(repaired.results.length, partial.results.length),
    'event log is byte-identical': () =>
      assert.equal(fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8'), before),
  });
});
