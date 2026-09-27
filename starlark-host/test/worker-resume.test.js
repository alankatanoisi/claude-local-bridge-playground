'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RunLedger } = require('../src/ledger');
const { restoreWorkerRun } = require('../src/worker-resume');

function temporaryLedger(t) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-worker-resume-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  return { ledger: new RunLedger(runDir), runDir };
}

function policyFor(documents) {
  return {
    maxJobsPerPhase: 4,
    inputIds: documents.map((document) => document.id),
    workerNames: ['code_analyst'],
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    defaultMaxOutputTokens: 900,
    maxOutputTokens: 2600,
    maxTaskCharacters: 1200,
    oneInputPerJob: true,
    requireAllInputs: true,
    allowDependencies: false,
  };
}

// Low #6 regression: the writer and resume reader must agree even when a
// document id contains characters that cannot safely appear in a basename.
test('resume reads input artifacts through the shared safe-name rule', (t) => {
  const { ledger, runDir } = temporaryLedger(t);
  const document = {
    id: 'doc/../odd id',
    kind: 'document',
    path: 'odd.js',
    bytes: 18,
    sha256: 'fixture-sha256',
  };
  const artifact = ledger.writeArtifact(`input-${document.id}`, {
    ...document,
    text: 'module.exports = 1;',
  });
  const job = {
    id: 'safe_job_id',
    worker: 'code_analyst',
    task: 'Analyze the unusual document identifier using only its saved input.',
    input_ids: [document.id],
    depends_on: [],
    timeout_ms: 30000,
    max_output_tokens: 900,
  };
  ledger.append('run_started', { documents: [document] });
  ledger.append('plan_validated', { jobs: [job], metrics: { model: 'mock' } });
  ledger.append('run_aborted', { reason: 'fixture', interruptedPhase: 'workers' });
  ledger.checkpoint({ phase: 'aborted', results: [] });

  const restored = restoreWorkerRun({
    ledger,
    objective: 'Exercise shared artifact names.',
    planSource: 'host_json',
    plannerModel: 'mock',
    plannerLadder: ['mock'],
    policyFor,
  });

  assert.equal(artifact, 'artifacts/input-doc_.._odd_id.json');
  assert.equal(fs.existsSync(path.join(runDir, artifact)), true);
  assert.equal(restored.kind, 'workers');
  assert.equal(restored.documents[0].id, document.id);
  assert.equal(restored.documents[0].text, 'module.exports = 1;');
});

// Low #7 regression: never drop a damaged final receipt. Resume must stop,
// name the problem, identify the ledger, and tell the operator what evidence
// was last known-good.
test('resume reports a named actionable error for a torn trailing JSONL line', (t) => {
  const { ledger } = temporaryLedger(t);
  ledger.append('job_succeeded', { jobId: 'job_1' });
  ledger.checkpoint({ phase: 'workers', results: [] });
  const tornLine = '{"seq":2,"type":"job_succeeded","payload":';
  fs.appendFileSync(ledger.eventsPath, tornLine);

  // RunLedger is also used by synthesis-only resume. It must refuse before
  // choosing a new sequence number or appending anything after torn evidence.
  assert.throws(
    () => new RunLedger(ledger.runDir),
    (error) => error.name === 'TornLedgerLineError',
  );

  assert.throws(
    () =>
      restoreWorkerRun({
        ledger,
        objective: 'Refuse ambiguous evidence.',
        planSource: 'host_json',
        plannerModel: 'mock',
        plannerLadder: ['mock'],
        policyFor,
      }),
    (error) => {
      assert.equal(error.name, 'TornLedgerLineError');
      assert.equal(error.eventsPath, ledger.eventsPath);
      assert.equal(error.lineNumber, 2);
      assert.equal(error.lastGoodSeq, 1);
      assert.equal(error.lastGoodType, 'job_succeeded');
      assert.match(error.message, /refusing to skip/i);
      assert.match(error.message, /last good event was job_succeeded seq=1/i);
      assert.match(error.message, /restore or repair the ledger from verified evidence/i);
      return true;
    },
  );

  // The refusal is read-only: the ambiguous bytes remain for investigation.
  assert.equal(fs.readFileSync(ledger.eventsPath, 'utf8').endsWith(tornLine), true);
});
