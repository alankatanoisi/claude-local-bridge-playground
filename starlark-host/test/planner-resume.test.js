'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const { CostBudget } = require('../src/bridge');
const { PhasedCoordinator } = require('../src/coordinator');
const { evaluateStarlark } = require('../src/starlark');
const { evaluatorRequired } = require('./helpers/evaluator-required');

const PLAN = `def plan(ctx):
    return [{"id": "job_one", "worker": "code_analyst", "task": "Analyze the supplied document carefully.", "input_ids": ["one"], "max_output_tokens": 900}]
`;
const WORKER = JSON.stringify({ summary: 'ok', claims: [], evidence: [], confidence: 0.5 });
const eventsAt = (dir) => fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

function fixture(t, responseFor = () => PLAN) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-resume-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'one.txt'), 'original input');
  const calls = [];
  const budget = new CostBudget(10);
  const bridge = {
    budget,
    async call(request) {
      calls.push(request);
      const text = /^(plan|recover):/.test(request.label)
        ? responseFor(request)
        : request.label.startsWith('worker:')
          ? WORKER
          : 'Synthesis complete.';
      // Simulate real settlement before returning the response. No network or
      // actual money is involved, but a duplicate purchase becomes observable.
      const reservation = await budget.reserve(0.01, request.label);
      await budget.settle(reservation, { label: request.label, costUsd: 0.01 });
      return { text, usage: {}, costUsd: 0.01, rawStopReason: 'end_turn' };
    },
  };
  const options = {
    config: {
      targetRoot: root,
      objective: 'Analyze the fixture.',
      documents: [{ id: 'one', path: 'one.txt' }],
      maxDocumentBytes: 1000,
      maxJobsPerPhase: 1,
      maxConcurrency: 1,
      maxTaskCharacters: 1200,
      maxStarlarkSteps: 100000,
      starlarkTimeoutMs: 1000,
      workerProfiles: { code_analyst: { maxOutputTokens: 1200, system: 'Return strict JSON.' } },
    },
    bridge,
    plannerModel: 'mock',
    workerModel: 'mock',
    faultProfile: 'none',
    runDir: path.join(root, 'run'),
  };
  return { root, calls, budget, options };
}

test('an unrelated evaluator failure during cancellation stays visible and is not a model rejection', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const diskError = new Error('evaluator host failed to read local input');
  const run = new PhasedCoordinator({
    ...f.options,
    controller,
    evaluatePlan() {
      // Cancellation is simultaneous with a separate host error. The host
      // error must reach the caller; a cancelled flag alone cannot explain it.
      controller.abort(new Error('SIGTERM'));
      throw diskError;
    },
  });
  await assert.rejects(run.run(), (error) => error === diskError);
  assert.equal(f.calls.filter((call) => call.label.startsWith('plan:')).length, 1);
  assert.equal(eventsAt(f.options.runDir).filter((event) => event.type === 'plan_rejected').length, 0);
});

test('accepted-source storage failure is not reported as model rejection or retried', async (t) => {
  const f = fixture(t);
  const run = new PhasedCoordinator({
    ...f.options,
    evaluatePlan: async () => ({
      result: [
        {
          id: 'job_one',
          worker: 'code_analyst',
          task: 'Analyze the supplied document carefully.',
          input_ids: ['one'],
          max_output_tokens: 900,
        },
      ],
      steps: 1,
    }),
  });
  const writeArtifact = run.ledger.writeArtifact.bind(run.ledger);
  run.ledger.writeArtifact = (name, value) => {
    if (name === 'plan-source-accepted') throw new Error('accepted artifact disk failure');
    return writeArtifact(name, value);
  };
  await assert.rejects(run.run(), /accepted artifact disk failure/);
  assert.equal(f.calls.filter((call) => call.label.startsWith('plan:')).length, 1);
  assert.equal(eventsAt(f.options.runDir).filter((event) => event.type === 'plan_rejected').length, 0);
});

test(
  'paid planner source survives evaluator abort and resumes without another planner call',
  { ...evaluatorRequired, timeout: 10000 },
  async (t) => {
    const f = fixture(t);
    const controller = new AbortController();
    let child;
    let closed;
    t.after(async () => {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed;
    });
    const original = new PhasedCoordinator({
      ...f.options,
      controller,
      async evaluatePlan({ signal }) {
        // This evaluator stand-in announces readiness over a pipe. The test
        // aborts only after the real child starts, so no sleep decides the race.
        assert.equal(f.calls.length, 1);
        assert.equal(f.budget.usedUsd, 0.01, 'planner response is already settled');
        child = spawn(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'], {
          signal,
        });
        closed = new Promise((resolve) => child.once('close', resolve));
        const aborted = new Promise((resolve, reject) => child.once('error', reject));
        const rejection = assert.rejects(aborted, { name: 'AbortError' });
        await once(child.stdout, 'data');
        controller.abort(new Error('interrupt paid plan evaluation'));
        await rejection;
        await closed;
        throw signal.reason;
      },
    });
    const stopped = await original.run();
    assert.equal(stopped.phase, 'aborted');
    assert.equal(child.signalCode, 'SIGTERM', 'exact evaluator child terminated');
    assert.equal(eventsAt(f.options.runDir).at(-1).type, 'run_aborted');

    // Changing the original input must not affect evaluation on resume: use the
    // saved bytes and metadata that the paid planner actually saw.
    fs.writeFileSync(path.join(f.root, 'one.txt'), 'changed after interruption');
    const evaluated = [];
    const resumed = await new PhasedCoordinator({
      ...f.options,
      evaluatePlan(options) {
        evaluated.push(options.source);
        return evaluateStarlark(options);
      },
    }).run({ resume: true });
    assert.equal(resumed.phase, 'completed');
    assert.deepEqual(evaluated, [PLAN.trim()]);
    assert.equal(f.calls.filter((call) => call.label.startsWith('plan:')).length, 1);
    assert.equal(eventsAt(f.options.runDir).filter((event) => event.type === 'plan_rejected').length, 0);
    assert.equal(eventsAt(f.options.runDir).filter((event) => event.type === 'plan_validated').length, 1);
    assert.equal(f.budget.reservedUsd, 0);
  },
);

// Stop at an evaluator boundary without a timer. The first regression above
// proves child termination; these cases exercise the saved-receipt decisions.
async function interruptEvaluation(f, shouldInterrupt = () => true, resume = false) {
  const controller = new AbortController();
  return new PhasedCoordinator({
    ...f.options,
    controller,
    evaluatePlan(options) {
      if (shouldInterrupt(options)) {
        controller.abort(new Error('pause evaluation'));
        throw controller.signal.reason;
      }
      return evaluateStarlark(options);
    },
  }).run({ resume });
}

test(
  'repeated evaluator interruptions reuse one paid response and retain attempt metrics',
  evaluatorRequired,
  async (t) => {
    const f = fixture(t);
    await interruptEvaluation(f);
    await interruptEvaluation(f, () => true, true);
    const result = await new PhasedCoordinator(f.options).run({ resume: true });
    assert.equal(result.phase, 'completed');
    assert.equal(result.planMetrics.attempts, 1);
    assert.equal(result.planMetrics.repairs, 0);
    assert.equal(f.calls.filter((call) => call.label.startsWith('plan:')).length, 1);
    const events = eventsAt(f.options.runDir);
    assert.equal(events.filter((event) => event.type === 'plan_response_received').length, 1);
    assert.equal(events.filter((event) => event.type === 'plan_rejected').length, 0);
    assert.equal(events.filter((event) => event.type === 'run_aborted').length, 2);
  },
);

test('resume preserves second-attempt numbering on an escalated planner tier', evaluatorRequired, async (t) => {
  const invalid = 'def plan(ctx):\n    return [{"model": "forbidden"}]';
  const f = fixture(t, (request) => (request.model === 'strong' && request.label.endsWith(':2') ? PLAN : invalid));
  f.options.plannerModel = 'cheap';
  f.options.plannerLadder = ['cheap', 'strong'];
  await interruptEvaluation(f, () => f.calls.length === 4);
  const result = await new PhasedCoordinator(f.options).run({ resume: true });
  assert.equal(result.phase, 'completed');
  assert.equal(result.planMetrics.attempts, 4);
  assert.equal(result.planMetrics.repairs, 3);
  assert.equal(result.planMetrics.model, 'strong');
  assert.equal(result.planMetrics.escalations, 1);
  assert.equal(f.calls.filter((call) => call.label.startsWith('plan:')).length, 4);
});

test(
  'saved invalid response is validated locally before one legitimate repair purchase',
  evaluatorRequired,
  async (t) => {
    const invalid = 'def plan(ctx):\n    return [{"model": "forbidden"}]';
    const f = fixture(t, (request) => (request.label.endsWith(':1') ? invalid : PLAN));
    await interruptEvaluation(f);
    const result = await new PhasedCoordinator(f.options).run({ resume: true });
    assert.equal(result.phase, 'completed');
    const calls = f.calls.filter((call) => call.label.startsWith('plan:'));
    assert.deepEqual(
      calls.map((call) => call.label),
      ['plan:mock:attempt:1', 'plan:mock:attempt:2'],
    );
    assert.match(calls[1].prompt, /unknown field 'model'/);
    assert.equal(eventsAt(f.options.runDir).filter((event) => event.type === 'plan_rejected').length, 1);
  },
);

test(
  'interrupted recovery source resumes without repurchasing either plan or replaying workers',
  evaluatorRequired,
  async (t) => {
    const recovery = `def recover(ctx):
    return [{"id": "retry_one", "retry_of": "job_one", "worker": "code_analyst", "task": "Retry analysis of the supplied document carefully.", "input_ids": ["one"], "max_output_tokens": 900}]
`;
    const f = fixture(t, (request) => (request.label.startsWith('recover:') ? recovery : PLAN));
    // The existing deterministic fault injector makes the first job retryable.
    f.options.faultProfile = 'mixed';
    await interruptEvaluation(f, (options) => options.functionName === 'recover');
    const before = eventsAt(f.options.runDir);
    assert.equal(before.filter((event) => event.type === 'job_failed').length, 1);
    const result = await new PhasedCoordinator(f.options).run({ resume: true });
    assert.equal(result.phase, 'completed');
    assert.equal(f.calls.filter((call) => call.label.startsWith('plan:')).length, 1);
    assert.equal(f.calls.filter((call) => call.label.startsWith('recover:')).length, 1);
    assert.equal(
      eventsAt(f.options.runDir).filter((event) => event.type === 'job_started' && event.payload.jobId === 'job_one')
        .length,
      1,
    );
    assert.equal(result.results.filter((item) => item.ok).length, 1);
  },
);

test('abort immediately after settlement still leaves the paid source resumable', evaluatorRequired, async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const call = f.options.bridge.call;
  f.options.bridge.call = async (request) => {
    const response = await call(request);
    if (request.label.startsWith('plan:')) controller.abort(new Error('abort after settlement'));
    return response;
  };
  const stopped = await new PhasedCoordinator({ ...f.options, controller }).run();
  assert.equal(stopped.phase, 'aborted');
  const result = await new PhasedCoordinator(f.options).run({ resume: true });
  assert.equal(result.phase, 'completed');
  assert.equal(f.calls.filter((request) => request.label.startsWith('plan:')).length, 1);
});

test(
  'invalid saved second attempt escalates once without replaying the exhausted tier',
  evaluatorRequired,
  async (t) => {
    const invalid = 'def plan(ctx):\n    return [{"model": "forbidden"}]';
    const f = fixture(t, (request) => (request.model === 'cheap' ? invalid : PLAN));
    f.options.plannerModel = 'cheap';
    f.options.plannerLadder = ['cheap', 'strong'];
    await interruptEvaluation(f, () => f.calls.length === 2);
    const result = await new PhasedCoordinator(f.options).run({ resume: true });
    assert.equal(result.phase, 'completed');
    assert.deepEqual(
      f.calls.filter((call) => call.label.startsWith('plan:')).map((call) => call.model),
      ['cheap', 'cheap', 'strong'],
    );
    assert.equal(result.planMetrics.attempts, 3);
    assert.equal(eventsAt(f.options.runDir).filter((event) => event.type === 'plan_escalated').length, 1);
  },
);

for (const damage of ['source', 'input', 'policy', 'escape', 'symlink', 'missing', 'model']) {
  test(`saved planner response refuses changed ${damage} before calls or ledger mutation`, async (t) => {
    const f = fixture(t);
    await interruptEvaluation(f);
    const eventsPath = path.join(f.options.runDir, 'events.jsonl');
    const artifactDir = path.join(f.options.runDir, 'artifacts');
    if (damage === 'source') {
      fs.writeFileSync(path.join(artifactDir, 'plan-source-attempt-1.json'), JSON.stringify({ source: 'changed' }));
    } else if (damage === 'input') {
      const file = path.join(artifactDir, 'input-one.json');
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), text: 'changed' }));
    } else if (damage === 'policy') {
      f.options.config.maxTaskCharacters += 1;
    } else if (damage === 'missing') {
      fs.unlinkSync(path.join(artifactDir, 'plan-source-attempt-1.json'));
    } else if (damage === 'symlink') {
      const file = path.join(artifactDir, 'plan-source-attempt-1.json');
      const outside = path.join(f.root, 'outside.json');
      fs.renameSync(file, outside);
      fs.symlinkSync(outside, file);
    } else {
      const events = eventsAt(f.options.runDir);
      const receipt = events.find((event) => event.type === 'plan_response_received').payload;
      if (damage === 'model') receipt.model = 'unexpected-model';
      else receipt.artifact = '../one.txt';
      fs.writeFileSync(eventsPath, events.map(JSON.stringify).join('\n') + '\n');
    }
    const before = fs.readFileSync(eventsPath, 'utf8');
    await assert.rejects(new PhasedCoordinator(f.options).run({ resume: true }), /mismatch|escapes|ENOENT/);
    assert.equal(f.calls.length, 1, 'no model call on corrupted evidence');
    assert.equal(fs.readFileSync(eventsPath, 'utf8'), before, 'ledger remains unchanged');
  });
}
