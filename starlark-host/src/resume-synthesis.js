'use strict';

/**
 * resume-synthesis.js — retry ONLY the synthesis stage of a partial run (R10).
 *
 * A run whose workers succeeded but whose synthesis refused/truncated/emptied
 * is `partial` with every worker artifact durable on disk. Re-running workers
 * to fix that would pay for answers we already own. This module reopens the
 * run, re-synthesizes from the recorded results, and appends the outcome to
 * the SAME run ledger (sequence numbers continue; nothing is rewritten).
 *
 * Default strategy on resume is map_reduce: a single ceiling-bound call is
 * usually what just failed.
 */

const fs = require('fs');
const path = require('path');

const { RunLedger, atomicWrite } = require('./ledger');
const { runSynthesis } = require('./synthesis');

function loadRunState(runDir) {
  const statePath = path.join(runDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`no state.json under ${runDir} — is this a run directory?`);
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

async function resumeSynthesis({
  runDir,
  bridge,
  model,
  objective,
  strategy = 'map_reduce',
  synthesisOptions = {},
}) {
  const state = loadRunState(runDir);
  if (state.phase !== 'partial' || !state.synthesisFailure) {
    throw new Error(
      `run is '${state.phase}' with synthesisFailure=${JSON.stringify(state.synthesisFailure || null)}; ` +
        'resume-synthesis only applies to partial runs whose synthesis failed',
    );
  }
  if (!Array.isArray(state.results) || state.results.length === 0) {
    throw new Error('run has no recorded worker results to synthesize');
  }

  const ledger = new RunLedger(runDir); // seq continues after existing events
  const resumeModel = model || state.plannerModel;
  const resolvedObjective = objective || state.objective || null;

  ledger.append('synthesis_resume_started', {
    previousFailure: state.synthesisFailure,
    strategy,
    model: resumeModel,
  });

  const synthesis = await runSynthesis({
    bridge,
    model: resumeModel,
    objective: resolvedObjective || 'Synthesize the recorded worker results faithfully.',
    results: state.results,
    options: { ...synthesisOptions, strategy },
  });

  state.synthesisStrategy = synthesis.strategy;
  state.synthesisCalls = (state.synthesisCalls || 0) + synthesis.calls;
  state.synthesisResumedAt = new Date().toISOString();

  if (synthesis.ok) {
    state.phase = 'completed';
    state.synthesis = synthesis.text;
    state.synthesisFailure = null;
    const artifact = ledger.writeArtifact('synthesis-resume', { text: synthesis.text });
    ledger.append('synthesis_resume_completed', { strategy: synthesis.strategy, calls: synthesis.calls, artifact });
  } else {
    state.synthesisFailure = synthesis.failure;
    ledger.append('synthesis_resume_failed', synthesis.failure);
  }

  ledger.checkpoint(state);
  atomicWrite(path.join(runDir, 'result.json'), state);

  return {
    runDir,
    ok: synthesis.ok,
    phase: state.phase,
    strategy: synthesis.strategy,
    calls: synthesis.calls,
    failure: synthesis.failure,
  };
}

module.exports = { loadRunState, resumeSynthesis };
