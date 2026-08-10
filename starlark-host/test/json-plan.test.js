'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildHostJsonPlan, buildHostJsonRecovery } = require('../src/json-plan');
const { validateJobs } = require('../src/validator');
const { loadExperimentConfig } = require('../src/config');
const { runWorkflow } = require('../src/workflow-runner');

function policyFixture() {
  return {
    maxJobsPerPhase: 6,
    inputIds: ['a', 'b'],
    workerNames: ['repo_file_analyst'],
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    defaultMaxOutputTokens: 1800,
    maxOutputTokens: 1800,
    maxTaskCharacters: 1200,
    failedJobIds: [],
    exactJobs: 2,
    oneInputPerJob: true,
    requireAllInputs: true,
    allowDependencies: false,
  };
}

test('host-JSON plans pass the same validator as model plans', () => {
  const documents = [
    { id: 'a', path: 'x.js' },
    { id: 'b', path: 'y.js' },
  ];
  const plan = buildHostJsonPlan({ documents, workerName: 'repo_file_analyst', policy: policyFixture() });
  const validated = validateJobs(plan, policyFixture(), 'plan');
  assert.equal(validated.length, 2);
  assert.deepEqual(validated.map((job) => job.input_ids).flat(), ['a', 'b']);
  // The cheap path takes NO shortcut around the gate: a tampered plan fails.
  assert.throws(
    () => validateJobs([{ ...plan[0], model: 'smuggled' }, plan[1]], policyFixture(), 'plan'),
    /unknown field/,
  );
});

test('host-JSON recovery retries retryable failures only', () => {
  const failures = [
    { job_id: 'analyze_a', worker: 'repo_file_analyst', task: 'Analyze input a for the stated objective.', input_ids: ['a'], retryable: true },
    { job_id: 'analyze_b', worker: 'repo_file_analyst', task: 'Analyze input b for the stated objective.', input_ids: ['b'], retryable: false },
  ];
  const policy = { ...policyFixture(), failedJobIds: ['analyze_a'], exactJobs: undefined, requireAllInputs: false };
  const retries = validateJobs(buildHostJsonRecovery({ failures, policy }), policy, 'recovery');
  assert.equal(retries.length, 1);
  assert.equal(retries[0].retry_of, 'analyze_a');
  // The validator itself refuses a host bug that retried the permanent one.
  const bad = buildHostJsonRecovery({ failures: failures.map((f) => ({ ...f, retryable: true })), policy });
  assert.throws(() => validateJobs(bad, policy, 'recovery'), /must retry one failed job/);
});

test('R14c + R9: the full pipeline runs with ZERO model calls (host plan, deterministic workers)', async () => {
  const config = loadExperimentConfig();
  const summary = await runWorkflow({
    config,
    workflowName: 'repo_fanout',
    mode: 'mock',
    faultProfile: 'mixed', // exercises host-JSON recovery too
    planSource: 'host_json',
    workerProvider: 'deterministic_analyst',
    runRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'json-plan-workflow-')),
  });
  assert.equal(summary.phase, 'completed');
  assert.equal(summary.inputs, 6);
  // The fault profile cycles index % 4, so with 6 jobs EVERY attempt-1 job
  // fails: 5 retryable + 1 permanent. Host-JSON recovery retries exactly the
  // 5, and the deterministic workers recover all of them — leaving the single
  // permanent gap the profile is designed to prove.
  assert.equal(summary.failures, 6, 'six attempt-1 failures, none on retry');
  assert.equal(summary.successes, 5, 'all five retryable failures recovered');
  assert.equal(summary.planAttempts, 0, 'no planner attempts on the cheap path');
  assert.equal(summary.estimatedCostUsd, 0);

  const events = fs.readFileSync(path.join(summary.runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /"planSource":"host_json"/);
  assert.doesNotMatch(events, /plan_rejected/);
});
