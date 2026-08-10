'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { CostBudget, MockBridge } = require('../src/bridge');
const {
  PhasedCoordinator,
  buildPlanPrompt,
  buildRecoveryPrompt,
  parseWorkerOutput,
  validateSynthesisResponse,
} = require('../src/coordinator');

test('planner and recovery prompts disclose the host policy they must satisfy', () => {
  const config = {
    objective: 'Analyze the fixtures.',
    maxJobsPerPhase: 4,
    maxTaskCharacters: 1200,
    workerProfiles: { code_analyst: { maxOutputTokens: 2600 } },
  };
  const documents = [{ id: 'one', path: 'one.txt' }];
  const failures = [
    {
      job_id: 'analyze_one',
      worker: 'code_analyst',
      input_ids: ['one'],
      retryable: true,
    },
  ];

  const planPrompt = buildPlanPrompt(config, documents);
  assert.match(planPrompt, /exactly 1 independent jobs/);
  assert.match(planPrompt, /1000 through 60000/);
  assert.match(planPrompt, /100 through 2600/);
  assert.match(planPrompt, /Do not include retry_of/);

  const recoveryPrompt = buildRecoveryPrompt(config, documents, failures);
  assert.match(recoveryPrompt, /retry only failures whose retryable field is true/);
  assert.match(recoveryPrompt, /name that job in retry_of/);
  assert.match(recoveryPrompt, /100 through 2600/);
});

test('worker response limits are enforced by the host parser', () => {
  const valid = JSON.stringify({
    summary: 'bounded summary',
    claims: ['one claim'],
    evidence: ['one source identifier'],
    confidence: 0.8,
  });
  assert.equal(parseWorkerOutput(valid).confidence, 0.8);

  const oversized = JSON.stringify({
    summary: 'x'.repeat(701),
    claims: [],
    evidence: [],
    confidence: 0.8,
  });
  assert.throws(() => parseWorkerOutput(oversized), /1\.\.700 characters/);
});

test('a refusal or empty final response cannot be recorded as successful synthesis', () => {
  assert.deepEqual(validateSynthesisResponse({ rawStopReason: 'refusal', text: '' }), {
    code: 'model_refusal',
    message: 'synthesis model returned stop_reason refusal',
  });
  assert.deepEqual(validateSynthesisResponse({ rawStopReason: 'end_turn', text: '' }), {
    code: 'empty_synthesis',
    message: 'synthesis model returned no text',
  });
  assert.deepEqual(validateSynthesisResponse({ rawStopReason: 'max_tokens', text: 'partial' }), {
    code: 'truncated_synthesis',
    message: 'synthesis model reached its token ceiling',
  });
  assert.equal(validateSynthesisResponse({ rawStopReason: 'end_turn', text: 'Grounded result' }), null);
});

test('phased hybrid records mixed failures and retries only retryable work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-hybrid-'));
  const docs = ['one', 'two', 'three', 'four'].map((id) => {
    fs.writeFileSync(path.join(root, `${id}.txt`), `fixture ${id}\n`);
    return { id, path: `${id}.txt` };
  });
  const config = {
    targetRoot: root,
    objective: 'Analyze each supplied fixture and preserve explicit evidence.',
    documents: docs,
    maxDocumentBytes: 1000,
    maxJobsPerPhase: 4,
    maxConcurrency: 2,
    maxStarlarkSteps: 100000,
    starlarkTimeoutMs: 1000,
    workerProfiles: {
      code_analyst: { maxOutputTokens: 1200, system: 'Return strict JSON.' },
    },
  };
  const budget = new CostBudget(0);
  const runDir = path.join(root, 'run');
  const coordinator = new PhasedCoordinator({
    config,
    bridge: new MockBridge({ budget }),
    plannerModel: 'mock-planner',
    workerModel: 'mock-worker',
    faultProfile: 'mixed',
    runDir,
  });

  const result = await coordinator.run();
  assert.equal(result.phase, 'completed');
  assert.equal(result.results.filter((item) => item.ok).length, 3);
  assert.equal(result.results.filter((item) => !item.ok).length, 4);
  assert.ok(fs.existsSync(path.join(runDir, 'events.jsonl')));
  assert.ok(fs.existsSync(path.join(runDir, 'result.json')));
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /recovery_plan_validated/);
  assert.match(events, /permanent_before_call/);
});

test('planner gets one measured repair turn after a rejected Starlark plan', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-repair-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const config = {
    targetRoot: root,
    objective: 'Analyze the supplied fixture.',
    documents: [{ id: 'one', path: 'one.txt' }],
    maxDocumentBytes: 1000,
    maxJobsPerPhase: 1,
    maxConcurrency: 1,
    maxTaskCharacters: 1200,
    maxStarlarkSteps: 100000,
    starlarkTimeoutMs: 1000,
    workerProfiles: {
      code_analyst: { maxOutputTokens: 1200, system: 'Return strict JSON.' },
    },
  };
  const budget = new CostBudget(0);
  const validBridge = new MockBridge({ budget });
  let rejectedOnce = false;
  const bridge = {
    budget,
    async call(request) {
      if (!rejectedOnce && request.label.startsWith('plan:')) {
        rejectedOnce = true;
        return {
          text: 'def plan(ctx):\n    return [{"id": "bad", "model": "forbidden"}]',
          usage: {},
          costUsd: 0,
          rawStopReason: 'end_turn',
        };
      }
      return validBridge.call(request);
    },
  };
  const runDir = path.join(root, 'run');
  const coordinator = new PhasedCoordinator({
    config,
    bridge,
    plannerModel: 'mock-planner',
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
  });

  const result = await coordinator.run();
  // lintFixes counts R6 auto-repairs on the ACCEPTED attempt (none here).
  assert.deepEqual(result.planMetrics, { attempts: 2, repairs: 1, firstPassValid: false, lintFixes: 0 });
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /plan_rejected/);
});
