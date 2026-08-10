'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CostBudget } = require('../src/bridge');
const { PhasedCoordinator } = require('../src/coordinator');

const WORKER_JSON = JSON.stringify({ summary: 'ok', claims: [], evidence: [], confidence: 0.5 });

const VALID_PLAN = [
  'def plan(ctx):',
  '    jobs = []',
  '    for doc in ctx["documents"]:',
  '        jobs.append({',
  '            "id": "analyze_" + doc["id"],',
  '            "worker": "code_analyst",',
  '            "task": "Analyze the supplied fixture document carefully.",',
  '            "input_ids": [doc["id"]],',
  '            "depends_on": [],',
  '            "timeout_ms": 30000,',
  '            "max_output_tokens": 900,',
  '        })',
  '    return jobs',
].join('\n');

// A plan that always fails validation: it smuggles a model field.
const INVALID_PLAN = 'def plan(ctx):\n    return [{"id": "bad", "model": "forbidden"}]';

function fixtureConfig(root) {
  return {
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
  };
}

test('R13: planning escalates one tier after the cheap tier exhausts repairs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const budget = new CostBudget(0);
  const calls = [];
  const bridge = {
    budget,
    async call(request) {
      calls.push({ model: request.model, label: request.label });
      let text;
      if (request.label.startsWith('plan:')) {
        text = request.model === 'cheap-tier' ? INVALID_PLAN : VALID_PLAN;
      } else if (request.label.startsWith('worker:')) {
        text = WORKER_JSON;
      } else {
        text = 'Synthesis complete.';
      }
      await budget.record({ label: request.label, costUsd: 0 });
      return { text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-run-'));
  const coordinator = new PhasedCoordinator({
    config: fixtureConfig(root),
    bridge,
    plannerModel: 'cheap-tier',
    plannerLadder: ['cheap-tier', 'strong-tier'],
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
  });

  const result = await coordinator.run();
  assert.equal(result.phase, 'completed');
  // Two failed attempts on the cheap tier, then first-try success above it.
  assert.deepEqual(result.planMetrics, {
    attempts: 3,
    repairs: 2,
    firstPassValid: false,
    lintFixes: 0,
    model: 'strong-tier',
    escalations: 1,
  });

  const planCalls = calls.filter((call) => call.label.startsWith('plan:'));
  assert.deepEqual(
    planCalls.map((call) => call.model),
    ['cheap-tier', 'cheap-tier', 'strong-tier'],
  );
  // Synthesis follows the tier that produced the accepted program.
  const synthesisCalls = calls.filter((call) => call.label.startsWith('synthesize:'));
  assert.ok(synthesisCalls.every((call) => call.model === 'strong-tier'));

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /plan_escalated/);
  assert.match(events, /"from":"cheap-tier","to":"strong-tier"/);

  // Rejected sources from both tiers survive as distinct artifacts.
  assert.ok(fs.existsSync(path.join(runDir, 'artifacts', 'plan-source-attempt-1.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'artifacts', 'plan-source-attempt-3.json')));
});

test('R13: a ladder that exhausts every tier fails with the last error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-fail-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const budget = new CostBudget(0);
  const bridge = {
    budget,
    async call(request) {
      await budget.record({ label: request.label, costUsd: 0 });
      return { text: INVALID_PLAN, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-fail-run-'));
  const coordinator = new PhasedCoordinator({
    config: fixtureConfig(root),
    bridge,
    plannerModel: 'tier-a',
    plannerLadder: ['tier-a', 'tier-b'],
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
  });
  await assert.rejects(coordinator.run(), /unknown field 'model'/);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  // Four rejections (two per tier) and exactly one escalation record.
  assert.equal((events.match(/plan_rejected/g) || []).length, 4);
  assert.equal((events.match(/plan_escalated/g) || []).length, 1);
});
