'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CostBudget, MockBridge } = require('../src/bridge');
const { PhasedCoordinator } = require('../src/coordinator');
const { createDeterministicProvider } = require('../src/deterministic-analyst');
const { contentHash } = require('../src/plan-hash');
const { fixture } = require('./helpers/r11-fixture');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function run(f, runDir, controller) {
  const provider = createDeterministicProvider();
  return new PhasedCoordinator({
    config: f.config,
    documents: f.documents,
    runDir,
    controller,
    bridge: new MockBridge({ budget: new CostBudget(0) }),
    workerRegistry: { publicProfiles: () => [], execute: (request) => provider.execute(request) },
    workerName: 'repo_file_analyst',
    plannerModel: 'mock',
    workerModel: 'mock',
    planSource: 'host_json',
    faultProfile: 'mixed',
  });
}

test('R14b hashes ignore object key order, preserve array order, and cover program bytes', () => {
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }), 'object ordering is canonical');
  assert.notEqual(contentHash([1, 2]), contentHash([2, 1]), 'descriptor ordering remains significant');
  assert.notEqual(
    contentHash('def plan(ctx): return []'),
    contentHash('def plan(ctx): return [1]'),
    'changed program bytes change hash',
  );
});

test('R14b accepted host plans record reproducible plan/program/input hashes', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const first = await run(f, path.join(f.root, 'first')).run();
  const second = await run(f, path.join(f.root, 'second')).run();
  assert.deepEqual(first.planHashes, second.planHashes, 'identical inputs and plans reproduce hashes');
  assert.deepEqual(first.recoveryHashes, second.recoveryHashes, 'identical recovery inputs reproduce hashes');
  const events = fs.readFileSync(path.join(f.root, 'first/events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const event of events.filter((event) => ['plan_validated', 'recovery_plan_validated'].includes(event.type))) {
    assert.equal(
      event.payload.hashes.planHash,
      contentHash(event.payload.jobs),
      'accepted descriptors match their hash',
    );
    assert.equal(
      event.payload.hashes.programHash,
      event.payload.hashes.planHash,
      'host program equals descriptor list',
    );
  }
  f.documents[0].text += '\n// changed source';
  const changed = await run(f, path.join(f.root, 'changed')).run();
  assert.equal(first.planHashes.planHash, changed.planHashes.planHash, 'same descriptors retain the same plan hash');
  assert.notEqual(
    first.planHashes.inputHash,
    changed.planHashes.inputHash,
    'actual changed input bytes change input hash',
  );
  assert.deepEqual(
    read(path.join(f.root, 'first/state.json')).planHashes,
    first.planHashes,
    'checkpoint retains accepted hashes',
  );
});

test('R14b resume refuses changed saved input bytes without adding job receipts', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  const original = run(f, f.runDir, controller);
  const execute = original.workerRegistry.execute;
  original.workerRegistry.execute = async (request) => {
    controller.abort(new Error('hash test interruption'));
    return execute(request);
  };
  await original.run();
  const inputFile = path.join(f.runDir, 'artifacts/input-doc1.json');
  const input = read(inputFile);
  fs.writeFileSync(inputFile, JSON.stringify({ ...input, text: 'changed saved bytes' }));
  const before = fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8');
  await assert.rejects(
    run(f, f.runDir).run({ resume: true }),
    /content hash mismatch/,
    'changed evidence fails closed',
  );
  assert.equal(
    fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8'),
    before,
    'failed resume adds no job events',
  );
});

test('R11 live resume refuses mode/cap/campaign changes before any network or ledger mutation', async (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const controller = new AbortController();
  const original = run(f, f.runDir, controller);
  // This is saved metadata ONLY. The fixture still uses MockBridge and $0.
  original.executionContext = {
    mode: 'live',
    maxCostUsd: 1,
    campaignId: 'original-campaign',
    budgetLedgerPath: path.join(f.root, 'missing-campaign/budget.ledger.jsonl'),
    traceLevel: 'off',
    workerProvider: 'deterministic_analyst',
  };
  original.workerRegistry.execute = async () => {
    controller.abort(new Error('metadata fixture'));
  };
  await original.run();
  const { resumeWorkerRun } = require('../src/workflow-runner');
  const before = fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8');
  const failures = [];
  for (const [name, options, pattern] of [
    ['implicit mock cannot resume live', {}, /mode must explicitly match/],
    ['live requires an explicit cap', { mode: 'live' }, /explicit positive cost cap/],
    ['live cannot raise the saved cap', { mode: 'live', maxCostUsd: 2 }, /retain the saved cost cap/],
    [
      'live cannot change campaigns',
      { mode: 'live', maxCostUsd: 1, campaignId: 'replacement' },
      /retain the saved cost cap/,
    ],
    [
      'missing ledger cannot create a fresh allowance',
      { mode: 'live', maxCostUsd: 1 },
      /saved campaign ledger is missing/,
    ],
  ]) {
    try {
      await assert.rejects(resumeWorkerRun({ runDir: f.runDir, ...options }), pattern, name);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], 'all independent live-resume guards reject');
  assert.equal(fs.readFileSync(path.join(f.runDir, 'events.jsonl'), 'utf8'), before, 'refused resumes add no events');
  assert.equal(
    fs.existsSync(path.dirname(original.executionContext.budgetLedgerPath)),
    false,
    'no replacement budget was created',
  );
});
