'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CostBudget } = require('../src/bridge');
const { aggregate, classifyRejection, runRepeatedTrials, scoreRun } = require('../src/evaluation-harness');

test('rejection classification is deterministic and flags authority fields', () => {
  assert.deepEqual(classifyRejection({ error: "job 0 contains unknown field 'model'" }), {
    class: 'unknown_field',
    field: 'model',
    authority: true,
  });
  assert.deepEqual(classifyRejection({ error: "job 0 contains unknown field 'notes'" }), {
    class: 'unknown_field',
    field: 'notes',
    authority: false,
  });
  assert.equal(classifyRejection({ error: "job 'a' timeout is outside policy" }).class, 'bounds_violation');
  assert.equal(classifyRejection({ error: 'job count 7 exceeds phase limit 4' }).class, 'count_violation');
  assert.equal(classifyRejection({ error: 'Starlark module failed: syntax' }).class, 'starlark_error');
  assert.equal(classifyRejection({ error: 'pre-lint rejected', lintRules: ['f-string'] }).class, 'lint_reject');
});

test('scoreRun reads the rubric from durable state and events', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-'));
  fs.writeFileSync(
    path.join(runDir, 'events.jsonl'),
    [
      JSON.stringify({ type: 'plan_rejected', attempt: 1, error: "job 0 contains unknown field 'provider'" }),
      JSON.stringify({ type: 'recovery_rejected', attempt: 1, error: 'Starlark module failed: x' }),
    ].join('\n') + '\n',
  );
  const state = {
    phase: 'partial',
    planMetrics: { attempts: 2, repairs: 1, firstPassValid: false, lintFixes: 1 },
    recoveryMetrics: { attempts: 2, repairs: 1, firstPassValid: false },
    synthesisFailure: { code: 'truncated_synthesis' },
    synthesisStrategy: 'single',
    cost: { calls: [{}, {}, {}] },
    results: [
      { ok: false, attempt: 1, job: { id: 'a' }, error: { retryable: true } },
      { ok: false, attempt: 1, job: { id: 'b' }, error: { retryable: true } },
      { ok: false, attempt: 1, job: { id: 'c' }, error: { retryable: false } },
      { ok: true, attempt: 1, job: { id: 'd' }, output: {} },
      { ok: true, attempt: 2, job: { id: 'retry_a', retry_of: 'a' }, output: {} },
      { ok: false, attempt: 2, job: { id: 'retry_b', retry_of: 'b' }, error: { retryable: true } },
    ],
  };
  const score = scoreRun({ state, runDir, costUsd: 0.12, durationMs: 1000, traceMetadata: null });
  assert.equal(score.planFirstPassValid, false);
  assert.equal(score.planLintFixes, 1);
  assert.equal(score.authorityAttempts, 1);
  assert.deepEqual(
    score.rejections.map((rejection) => rejection.class),
    ['unknown_field', 'starlark_error'],
  );
  assert.equal(score.retryableFailures, 2);
  assert.equal(score.permanentFailures, 1);
  assert.equal(score.retriesProposed, 2);
  assert.equal(score.retriesSucceeded, 1);
  assert.equal(score.permanentRetried, 0);
  assert.equal(score.acceptedArtifacts, 2); // job d (attempt 1) + retry_a (attempt 2)
  assert.equal(score.synthesisState, 'truncated_synthesis');
  assert.equal(score.costUsd, 0.12);
});

test('mock repeated trials run the full loop and aggregate per model', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-fixture-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  fs.writeFileSync(path.join(root, 'two.txt'), 'fixture two\n');
  const config = {
    runnerRepo: path.resolve(__dirname, '../..'),
    targetRoot: root,
    objective: 'Analyze the supplied fixtures.',
    documents: [
      { id: 'one', path: 'one.txt' },
      { id: 'two', path: 'two.txt' },
    ],
    maxDocumentBytes: 1000,
    maxJobsPerPhase: 2,
    maxConcurrency: 1,
    maxTaskCharacters: 1200,
    maxStarlarkSteps: 100000,
    starlarkTimeoutMs: 1000,
    fixedWorkerModel: 'mock-worker',
    workerProfiles: { code_analyst: { maxOutputTokens: 1200, system: 'Return strict JSON.' } },
  };
  const budget = new CostBudget(0);
  const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-runs-'));
  const progress = [];
  const trials = await runRepeatedTrials({
    config,
    models: ['mock-a', 'mock-b'],
    reps: 2,
    mode: 'mock',
    budget,
    faultProfile: 'none',
    evalRoot,
    onTrialComplete: (trial) => progress.push(`${trial.model}:${trial.rep}`),
  });

  assert.equal(trials.length, 4);
  assert.deepEqual(progress, ['mock-a:1', 'mock-a:2', 'mock-b:1', 'mock-b:2']);
  assert.ok(trials.every((trial) => trial.score.phase === 'completed'));
  assert.ok(trials.every((trial) => trial.score.planFirstPassValid === true));
  assert.ok(trials.every((trial) => fs.existsSync(path.join(trial.runDir, 'state.json'))));

  const summary = aggregate(trials);
  assert.deepEqual(Object.keys(summary).sort(), ['mock-a', 'mock-b']);
  assert.equal(summary['mock-a'].trials, 2);
  assert.equal(summary['mock-a'].completedRuns, 2);
  assert.equal(summary['mock-a'].planFirstPassRate, 1);
  assert.equal(summary['mock-a'].meanCostUsd, 0);
  assert.deepEqual(summary['mock-a'].synthesisOutcomes, { completed: 2 });
});
