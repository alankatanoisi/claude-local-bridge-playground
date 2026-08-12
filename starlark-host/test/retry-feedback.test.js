'use strict';

/**
 * D-F1: rejected workers learn WHY (docs/starlark-r4-worker-eval-2026-08-10.md).
 *
 * The worker-axis evaluation found the repair asymmetry: planners receive the
 * host's rejection reason and fix it; workers received only "return strict
 * JSON" and repeated the identical mistake (Opus 5: fifteen times). These
 * tests pin the fix: retry prompts carry the host's exact rejection message,
 * first attempts never do, the feedback is recorded on the run ledger, and it
 * works identically for model-planned and host-JSON recovery.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CostBudget } = require('../src/bridge');
const { PhasedCoordinator, buildWorkerPrompt } = require('../src/coordinator');
const { WORKER_OUTPUT_LIMITS } = require('../src/worker-contract');

const GOOD_JSON = JSON.stringify({ summary: 'ok', claims: [], evidence: [], confidence: 0.5 });

test('buildWorkerPrompt appends host feedback only when provided', () => {
  const job = { id: 'j', task: 'Analyze the fixture document carefully.', input_ids: ['a'] };
  const documents = [{ id: 'a', relativePath: 'x.js', sha256: 'h', text: 'body' }];
  const plain = buildWorkerPrompt('objective', job, documents);
  assert.doesNotMatch(plain, /PREVIOUS ATTEMPT REJECTED/);
  const withFeedback = buildWorkerPrompt('objective', job, documents, {
    code: 'invalid_worker_output',
    message: 'summary must be 1..1200 characters',
  });
  assert.match(withFeedback, /PREVIOUS ATTEMPT REJECTED BY THE HOST \(invalid_worker_output\)/);
  assert.match(withFeedback, /summary must be 1\.\.1200 characters/);
  assert.match(withFeedback, /All other contract rules still apply/);
});

// Full pipeline: worker returns an over-ceiling summary on attempt 1 (a real
// contract violation, not an injected fault), then a compliant one on the
// retry. The retry prompt must carry the validator's message.
test('a worker rejected for a real contract violation retries WITH the reason', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const budget = new CostBudget(0);
  const workerPrompts = [];
  const oversized = JSON.stringify({
    summary: 'x'.repeat(WORKER_OUTPUT_LIMITS.summaryMaxChars + 50),
    claims: [],
    evidence: [],
    confidence: 0.5,
  });
  let workerCalls = 0;
  const bridge = {
    budget,
    async call(request) {
      let text;
      if (request.label.startsWith('plan:') || request.label.startsWith('recover:')) {
        const fn = request.label.startsWith('plan:') ? 'plan' : 'recover';
        text =
          fn === 'plan'
            ? 'def plan(ctx):\n    return [{"id": "analyze_one", "worker": "code_analyst", "task": "Analyze the supplied fixture document.", "input_ids": ["one"], "depends_on": [], "timeout_ms": 30000, "max_output_tokens": 900}]'
            : 'def recover(ctx):\n    jobs = []\n    for f in ctx["failures"]:\n        if f["retryable"]:\n            jobs.append({"id": "retry_" + f["job_id"], "retry_of": f["job_id"], "worker": f["worker"], "task": f["task"], "input_ids": f["input_ids"], "depends_on": [], "timeout_ms": 30000, "max_output_tokens": 900})\n    return jobs';
      } else if (request.label.startsWith('worker:')) {
        workerPrompts.push(request.prompt);
        workerCalls += 1;
        text = workerCalls === 1 ? oversized : GOOD_JSON;
      } else {
        text = 'Synthesis complete.';
      }
      await budget.record({ label: request.label, costUsd: 0 });
      return { text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-run-'));
  const coordinator = new PhasedCoordinator({
    config: {
      targetRoot: root,
      objective: 'Analyze the supplied fixture.',
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
    plannerModel: 'mock-planner',
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
  });
  const result = await coordinator.run();

  assert.equal(result.phase, 'completed');
  assert.equal(result.results.filter((r) => r.ok).length, 1, 'the retry must succeed');
  assert.equal(workerPrompts.length, 2);
  // Attempt 1: no feedback. Attempt 2: the validator's exact reason.
  assert.doesNotMatch(workerPrompts[0], /PREVIOUS ATTEMPT REJECTED/);
  assert.match(workerPrompts[1], /PREVIOUS ATTEMPT REJECTED BY THE HOST \(invalid_worker_output\)/);
  assert.match(workerPrompts[1], new RegExp(`1\\.\\.${WORKER_OUTPUT_LIMITS.summaryMaxChars} characters`));

  // The ledger records what the retry was told.
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /"retryFeedback":\{"code":"invalid_worker_output"/);
});

test('host-JSON recovery retries also carry the feedback (R14c path)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-json-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const budget = new CostBudget(0);
  const workerPrompts = [];
  let workerCalls = 0;
  const bridge = {
    budget,
    async call(request) {
      if (request.label.startsWith('worker:')) {
        workerPrompts.push(request.prompt);
        workerCalls += 1;
        // First attempt: not even JSON. Retry: compliant.
        const text = workerCalls === 1 ? 'this is not JSON at all' : GOOD_JSON;
        await budget.record({ label: request.label, costUsd: 0 });
        return { text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
      }
      await budget.record({ label: request.label, costUsd: 0 });
      return { text: 'Synthesis complete.', usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-json-run-'));
  const coordinator = new PhasedCoordinator({
    config: {
      targetRoot: root,
      objective: 'Analyze the supplied fixture.',
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
    plannerModel: 'unused',
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
    planSource: 'host_json',
  });
  const result = await coordinator.run();
  assert.equal(result.phase, 'completed');
  assert.equal(workerPrompts.length, 2);
  assert.match(workerPrompts[1], /PREVIOUS ATTEMPT REJECTED BY THE HOST \(invalid_worker_output\)/);
  // JSON.parse's own message is what the worker gets — imperfect but honest.
  assert.match(workerPrompts[1], /Unexpected token|not valid JSON/);
});
