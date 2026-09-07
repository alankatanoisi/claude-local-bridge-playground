'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const { ClaudeBridge, MockBridge } = require('../src/bridge');
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
    'checkpoint is recognizable as aborted': () => assert.equal(read(path.join(runDir, 'state.json')).phase, 'aborted'),
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

test('R11 cooperative abort: late deterministic completions cannot become results', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const budget = await budgetFor(f);
  const controller = new AbortController();
  const real = createDeterministicProvider();
  let active = 0;
  let ready;
  const started = new Promise((resolve) => {
    ready = resolve;
  });
  const workerRegistry = {
    publicProfiles: () => [],
    async execute(request) {
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
  predicates(abortChecks(f.runDir, budget));
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
