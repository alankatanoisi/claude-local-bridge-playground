'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RunLedger } = require('../src/ledger');
const { resumeSynthesis } = require('../src/resume-synthesis');
const { resolveSynthesisOptions, runSynthesis } = require('../src/synthesis');

function fixtureResults(count) {
  return Array.from({ length: count }, (_, index) => ({
    ok: true,
    job: { id: `job_${index + 1}` },
    attempt: 1,
    output: { summary: `finding ${index + 1}`, claims: [], evidence: [], confidence: 0.9 },
  }));
}

function stubBridge(responder) {
  const calls = [];
  return {
    calls,
    async call(request) {
      calls.push(request);
      return responder(request, calls.length);
    },
  };
}

const okResponse = (text) => ({ text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' });

test('auto strategy: small result sets stay single-call, large ones map-reduce', () => {
  assert.equal(resolveSynthesisOptions({}, 2).strategy, 'single');
  assert.equal(resolveSynthesisOptions({}, 4).strategy, 'single');
  assert.equal(resolveSynthesisOptions({}, 5).strategy, 'map_reduce');
  assert.equal(resolveSynthesisOptions({ strategy: 'single' }, 50).strategy, 'single');
  assert.equal(resolveSynthesisOptions({ strategy: 'map_reduce' }, 1).strategy, 'map_reduce');
});

test('map-reduce chunks the results and combines part summaries', async () => {
  const bridge = stubBridge((request) =>
    okResponse(request.label.includes(':reduce:') ? 'FINAL SYNTHESIS' : `part covering ${request.label}`),
  );
  const outcome = await runSynthesis({
    bridge,
    model: 'stub-model',
    objective: 'test objective',
    results: fixtureResults(7),
    options: { strategy: 'map_reduce', chunkSize: 3 },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.strategy, 'map_reduce');
  assert.equal(outcome.calls, 4); // ceil(7/3) map calls + 1 reduce
  assert.equal(outcome.text, 'FINAL SYNTHESIS');

  const labels = bridge.calls.map((request) => request.label);
  assert.deepEqual(labels.slice(0, 3), [
    'synthesize:map:1of3:stub-model',
    'synthesize:map:2of3:stub-model',
    'synthesize:map:3of3:stub-model',
  ]);
  assert.equal(labels[3], 'synthesize:reduce:stub-model');
  // Chunks are disjoint: job_4 appears in the second map prompt only.
  assert.match(bridge.calls[1].prompt, /job_4/);
  assert.doesNotMatch(bridge.calls[0].prompt, /job_4/);
  // The reduce call sees part summaries and aggregate counts, not raw results.
  assert.match(bridge.calls[3].prompt, /PART 1/);
  assert.match(bridge.calls[3].prompt, /7 jobs, 7 succeeded, 0 failed/);
});

test('a truncated map call fails closed with stage and chunk recorded', async () => {
  const bridge = stubBridge((request) =>
    request.label.startsWith('synthesize:map:2')
      ? { text: 'partial…', usage: {}, costUsd: 0, rawStopReason: 'max_tokens' }
      : okResponse('fine'),
  );
  const outcome = await runSynthesis({
    bridge,
    model: 'stub-model',
    objective: 'test objective',
    results: fixtureResults(7),
    options: { strategy: 'map_reduce', chunkSize: 3 },
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.failure, {
    code: 'truncated_synthesis',
    message: 'synthesis model reached its token ceiling',
    stage: 'map',
    chunk: 2,
    chunks: 3,
  });
  assert.equal(outcome.calls, 2, 'must stop at the failing chunk, not spend the rest');
});

test('RunLedger reopening continues sequence numbers instead of restarting', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-resume-'));
  const first = new RunLedger(runDir);
  first.append('one');
  first.append('two');
  const second = new RunLedger(runDir);
  const event = second.append('three');
  assert.equal(event.seq, 3);
});

// Build a minimal on-disk partial run, shaped like a real workflow run.
function partialRunFixture() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-syn-'));
  const ledger = new RunLedger(runDir);
  ledger.append('run_started', {});
  ledger.append('synthesis_failed', { code: 'truncated_synthesis' });
  const state = {
    phase: 'partial',
    plannerModel: 'stub-planner',
    results: fixtureResults(6),
    synthesis: null,
    synthesisFailure: { code: 'truncated_synthesis', message: 'synthesis model reached its token ceiling' },
    synthesisCalls: 1,
  };
  ledger.checkpoint(state);
  return { runDir, state };
}

test('resume-synthesis completes a partial run without re-running workers', async () => {
  const { runDir } = partialRunFixture();
  const bridge = stubBridge((request) =>
    okResponse(request.label.includes(':reduce:') ? 'HEALED SYNTHESIS' : 'part summary'),
  );

  const summary = await resumeSynthesis({ runDir, bridge, objective: 'test objective' });

  assert.equal(summary.ok, true);
  assert.equal(summary.phase, 'completed');
  assert.equal(summary.strategy, 'map_reduce');
  // No worker labels anywhere: synthesis-only retry by construction.
  assert.ok(bridge.calls.every((request) => request.label.startsWith('synthesize:')));

  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(state.phase, 'completed');
  assert.equal(state.synthesis, 'HEALED SYNTHESIS');
  assert.equal(state.synthesisFailure, null);
  assert.equal(state.synthesisCalls, 1 + 3); // prior single + (2 maps of 3 + reduce)

  // Ledger: events appended AFTER the originals with continuing seq.
  const events = fs
    .readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ['run_started', 'synthesis_failed', 'synthesis_resume_started', 'synthesis_resume_completed']);
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4]);
  assert.ok(fs.existsSync(path.join(runDir, 'artifacts', 'synthesis-resume.json')));
  assert.ok(fs.existsSync(path.join(runDir, 'result.json')));
});

test('resume-synthesis records a repeat failure and keeps the run partial', async () => {
  const { runDir } = partialRunFixture();
  const bridge = stubBridge(() => ({ text: '', usage: {}, costUsd: 0, rawStopReason: 'refusal' }));

  const summary = await resumeSynthesis({ runDir, bridge, objective: 'test objective' });
  assert.equal(summary.ok, false);
  assert.equal(summary.phase, 'partial');
  assert.equal(summary.failure.code, 'model_refusal');

  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(state.phase, 'partial');
  assert.equal(state.synthesisFailure.code, 'model_refusal');
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /synthesis_resume_failed/);
});

test('resume-synthesis refuses completed runs and runs without results', async () => {
  const { runDir } = partialRunFixture();
  const statePath = path.join(runDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.phase = 'completed';
  state.synthesisFailure = null;
  fs.writeFileSync(statePath, JSON.stringify(state));
  await assert.rejects(
    resumeSynthesis({ runDir, bridge: stubBridge(() => okResponse('x')) }),
    /only applies to partial runs/,
  );
});
