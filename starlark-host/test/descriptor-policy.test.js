'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ALLOWED_KEYS, DESCRIPTOR_FIELDS, LIMITS, policyDisclosure } = require('../src/descriptor-policy');
const { PhasedCoordinator, buildPlanPrompt, buildRecoveryPrompt } = require('../src/coordinator');
const { validateJobs } = require('../src/validator');

// A representative per-run policy object, shaped like PhasedCoordinator.policy().
function fixturePolicy(overrides = {}) {
  return {
    maxJobsPerPhase: 4,
    inputIds: ['doc1'],
    workerNames: ['probe_worker'],
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    defaultMaxOutputTokens: 2600,
    maxOutputTokens: 2600,
    maxTaskCharacters: 1200,
    failedJobIds: [],
    exactJobs: undefined,
    oneInputPerJob: true,
    requireAllInputs: false,
    allowDependencies: false,
    ...overrides,
  };
}

function fixtureJob(overrides = {}) {
  return {
    id: 'probe_job',
    worker: 'probe_worker',
    task: 'Analyze the probe document carefully.',
    input_ids: ['doc1'],
    depends_on: [],
    timeout_ms: 12345,
    max_output_tokens: 456,
    ...overrides,
  };
}

test('concordance: every accepted descriptor field documents its enforcement point', () => {
  for (const key of ALLOWED_KEYS) {
    const field = DESCRIPTOR_FIELDS.find((candidate) => candidate.name === key);
    assert.ok(field, `field '${key}' missing from DESCRIPTOR_FIELDS`);
    assert.ok(
      typeof field.enforcement === 'string' && field.enforcement.length > 10,
      `field '${key}' lacks an enforcement description`,
    );
    assert.ok(field.phases.length >= 1, `field '${key}' lists no phases`);
  }
  // And the reverse: no schema entry outside the validator's accepted set.
  for (const field of DESCRIPTOR_FIELDS) {
    assert.ok(ALLOWED_KEYS.has(field.name), `schema field '${field.name}' not in ALLOWED_KEYS`);
  }
});

test('concordance: the prompt discloses exactly the bounds the validator enforces', () => {
  const policy = fixturePolicy();
  const disclosure = policyDisclosure({
    policy,
    phase: 'plan',
    workerName: 'probe_worker',
    documentCount: 1,
  });

  // The disclosed numbers come from the same objects the validator reads.
  assert.match(disclosure, new RegExp(`from ${LIMITS.timeoutMinMs} through ${policy.maxTimeoutMs}`));
  assert.match(disclosure, new RegExp(`from ${LIMITS.outputTokensMin} through ${policy.maxOutputTokens}`));
  assert.match(disclosure, new RegExp(`${LIMITS.taskMinCharacters} through ${policy.maxTaskCharacters} characters`));

  // Bound faithfulness: one inside and one outside each disclosed bound.
  assert.doesNotThrow(() => validateJobs([fixtureJob({ timeout_ms: policy.maxTimeoutMs })], policy));
  assert.throws(() => validateJobs([fixtureJob({ timeout_ms: policy.maxTimeoutMs + 1 })], policy), /timeout/);
  assert.throws(() => validateJobs([fixtureJob({ timeout_ms: LIMITS.timeoutMinMs - 1 })], policy), /timeout/);
  assert.doesNotThrow(() => validateJobs([fixtureJob({ max_output_tokens: policy.maxOutputTokens })], policy));
  assert.throws(
    () => validateJobs([fixtureJob({ max_output_tokens: policy.maxOutputTokens + 1 })], policy),
    /max_output_tokens/,
  );
  assert.throws(
    () => validateJobs([fixtureJob({ task: 'x'.repeat(policy.maxTaskCharacters + 1) })], policy),
    /task/,
  );

  // Field lists in the disclosure match the phase-specific schema.
  assert.match(disclosure, /exactly: id, worker, task, input_ids, depends_on, timeout_ms, max_output_tokens\./);
  const recovery = policyDisclosure({ policy, phase: 'recovery', workerName: 'probe_worker', documentCount: 1 });
  assert.match(recovery, /retry_of/);
});

test('concordance: prompt builders render disclosure from the run policy, not hardcoded text', () => {
  const config = {
    objective: 'probe objective',
    workerName: 'probe_worker',
    maxJobsPerPhase: 4,
    maxTaskCharacters: 777, // deliberately unusual so a hardcoded prompt would not match
    workerProfiles: { probe_worker: { route: 'analysis', maxOutputTokens: 1234, system: 'probe', effort: 'low' } },
  };
  const documents = [{ id: 'doc1', kind: 'document', path: 'x.js', bytes: 5, sha256: 'h' }];
  const policy = fixturePolicy({ maxTaskCharacters: 777, maxOutputTokens: 1234, defaultMaxOutputTokens: 1234 });

  const plan = buildPlanPrompt(config, documents, 'probe_worker', policy);
  assert.match(plan, /10 through 777 characters/);
  assert.match(plan, /from 100 through 1234/);

  const recovery = buildRecoveryPrompt(config, documents, [], 'probe_worker', policy);
  assert.match(recovery, /10 through 777 characters/);
  assert.match(recovery, /retry_of/);
});

test('concordance probe: validated timeout_ms and max_output_tokens reach the worker call', async () => {
  const policy = fixturePolicy();
  const [job] = validateJobs([fixtureJob()], policy);

  const captured = [];
  const workerRegistry = {
    publicProfiles: () => [{ name: 'probe_worker' }],
    execute: async (request) => {
      captured.push(request);
      return {
        text: JSON.stringify({ summary: 'ok', claims: [], evidence: [], confidence: 0.5 }),
        usage: {},
        costUsd: 0,
        rawStopReason: 'end_turn',
      };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'concordance-'));
  const coordinator = new PhasedCoordinator({
    config: {
      objective: 'probe objective',
      workerName: 'probe_worker',
      maxConcurrency: 1,
      maxJobsPerPhase: 4,
      maxTaskCharacters: 1200,
      workerProfiles: { probe_worker: { route: 'analysis', maxOutputTokens: 2600, system: 'probe', effort: 'low' } },
    },
    bridge: { budget: { usedUsd: 0, calls: [] } },
    plannerModel: 'probe-planner',
    workerModel: 'probe-worker-model',
    faultProfile: 'none',
    runDir,
    workerName: 'probe_worker',
    workerRegistry,
  });

  const documents = [
    { id: 'doc1', relativePath: 'x.js', bytes: 5, sha256: 'h', text: 'probe document body' },
  ];
  const results = await coordinator.runJobs([job], documents, 1);

  assert.equal(results[0].ok, true);
  assert.equal(captured.length, 1);
  const request = captured[0];
  // finding-6 class: the validated values must be OBSERVABLE at the execution boundary.
  assert.equal(request.timeoutMs, 12345, 'validated timeout_ms must reach the worker call');
  assert.equal(request.maxTokens, 456, 'validated max_output_tokens must reach the worker call');
  assert.equal(request.workerName, 'probe_worker');
  assert.match(request.prompt, /Analyze the probe document carefully\./, 'task must be in the worker prompt');
  assert.match(request.prompt, /probe document body/, 'referenced input text must be in the worker prompt');
  assert.match(request.label, /probe_job/, 'job id must key the call label');
});

test('unknown and smuggled descriptor fields are rejected, including __proto__', () => {
  const policy = fixturePolicy();
  for (const smuggled of ['model', 'provider', 'shell', 'path', 'Model']) {
    assert.throws(
      () => validateJobs([{ ...fixtureJob(), [smuggled]: 'x' }], policy),
      /unknown field/,
      `field '${smuggled}' must be rejected`,
    );
  }
  // A __proto__ own-property from parsed JSON must be rejected as unknown,
  // never absorbed into the object graph.
  const withProto = JSON.parse(
    '{"id":"probe_job","worker":"probe_worker","task":"Analyze the probe document carefully.",' +
      '"input_ids":["doc1"],"depends_on":[],"timeout_ms":12345,"max_output_tokens":456,"__proto__":{"admin":true}}',
  );
  assert.throws(() => validateJobs([withProto], policy), /unknown field/);
});
