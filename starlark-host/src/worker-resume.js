'use strict';

/**
 * worker-resume.js — rebuild a run from its ledger so `--resume` can continue.
 *
 * Extracted from PhasedCoordinator for thermo-nuclear Medium #4: resume used
 * to be ~116 lines of ledger forensics inlined in coordinator.js, and the
 * coordinator then REPLAYED every phase with caches. Now this module answers
 * one question — "what does the evidence on disk say this run is?" — and the
 * coordinator's phase methods each do only the work the answer leaves open.
 *
 * Truth order, most to least authoritative:
 *   1. events.jsonl — every line fsync'd before the host moved on. A recorded
 *      `run_completed` wins even when state.json is a step behind.
 *   2. artifacts/    — saved inputs and worker outputs the receipts point at.
 *   3. state.json    — the latest checkpoint; used for phase and metrics only.
 *
 * Fail closed. A torn line, a missing plan AND response, a hash mismatch, an unknown or
 * duplicate receipt, or an artifact outside the run folder all REFUSE resume.
 * Silently skipping a damaged success receipt would turn a paid job into a
 * duplicate execution — the exact bug the abort-commit protocol closed.
 *
 * Returns one of:
 *   { kind: 'completed', state, staleCheckpoint }  — nothing to do
 *   { kind: 'partial',   state }                   — synthesis failed; use resume-synthesis.js
 *   { kind: 'workers',   state, documents, inputHash, activePlannerModel,
 *                        ladderIndex, resumeData: { plan, recovery, results, pending } }
 */

const fs = require('fs');
const path = require('path');

const { safeArtifactName } = require('./artifact-name');
const { inputContentHash, publicDocument } = require('./documents');
const { readLedgerEvents } = require('./ledger');
const { pendingPlannerResponse } = require('./planner-response');
const { acceptedPlanHashes, contentHash } = require('./plan-hash');
const { validateJobs } = require('./validator');
const { parseWorkerOutput } = require('./worker-contract');

function readEvents(ledger) {
  // Every line must parse. A truncated `job_succeeded` cannot be skipped:
  // doing so would look like "never completed" and could re-run paid work.
  const events = readLedgerEvents(ledger.eventsPath);
  if (events.some((event, index) => index && event.seq <= events[index - 1].seq)) {
    throw new Error('run ledger sequence is not strictly increasing');
  }
  return events;
}

// A retry's success receipt is newer evidence than the original failed run.
// Read the text it points to; result.json and state.json may both be stale.
function restoreSynthesisResume(ledger, saved, events = readEvents(ledger)) {
  const completed = events.filter((event) => event.type === 'synthesis_resume_completed').pop();
  if (!completed) return null;
  const receipt = completed.payload;
  if (
    typeof receipt?.artifact !== 'string' ||
    !['single', 'map_reduce'].includes(receipt.strategy) ||
    !Number.isInteger(receipt.calls) ||
    receipt.calls < 1
  )
    throw new Error('invalid synthesis resume completion receipt');
  const artifactPath = path.resolve(ledger.runDir, receipt.artifact);
  const artifactRoot = fs.realpathSync(ledger.artifactDir) + path.sep;
  // Check the real path too, so a symbolic link cannot point outside artifacts.
  if (
    !artifactPath.startsWith(path.resolve(ledger.artifactDir) + path.sep) ||
    !fs.realpathSync(artifactPath).startsWith(artifactRoot)
  ) {
    throw new Error('synthesis resume artifact escapes run artifacts');
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  if (typeof artifact.text !== 'string' || !artifact.text.trim()) {
    throw new Error('invalid synthesis resume artifact text');
  }
  return {
    ...saved,
    phase: 'completed',
    synthesis: artifact.text,
    synthesisFailure: null,
    synthesisStrategy: receipt.strategy,
    // lastSeq tells us whether this checkpoint already counted the retry.
    synthesisCalls: (saved.synthesisCalls || 0) + (saved.lastSeq >= completed.seq ? 0 : receipt.calls),
    synthesisResumedAt: completed.at,
  };
}

function restoreWorkerRun({ ledger, objective, planSource, plannerModel, plannerLadder, policyFor }) {
  const saved = JSON.parse(fs.readFileSync(ledger.statePath, 'utf8'));
  const events = readEvents(ledger);

  if (saved.phase === 'completed') return { kind: 'completed', state: saved, staleCheckpoint: false };
  const resumed = restoreSynthesisResume(ledger, saved, events);
  if (resumed) return { kind: 'completed', state: resumed, staleCheckpoint: true };
  const completed = events.find((event) => event.type === 'run_completed');
  if (completed) {
    // Medium #3 companion: the final checkpoint was lost after run_completed
    // was recorded. result.json is written atomically just before that
    // checkpoint, so it normally carries the full final state; the stale
    // checkpoint is only the fallback when result.json is missing too.
    const resultPath = path.join(ledger.runDir, 'result.json');
    const state = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : saved;
    if (completed.payload?.synthesisOk === false) {
      // run_completed is ALSO written when synthesis FAILED (refusal,
      // truncation, empty text): every worker was paid for and is durable,
      // only the synthesis step is still owed. The event name alone must not
      // promote that into a "completed" run (Codex handoff 2026-09-16 §6).
      // Rebuild the partial state so resume-synthesis.js can act on it.
      const failed = events.filter((event) => event.type === 'synthesis_failed').pop();
      return {
        kind: 'partial',
        state: {
          ...state,
          phase: 'partial',
          synthesis: null,
          synthesisFailure: state.synthesisFailure || failed?.payload || { code: 'synthesis_failed' },
        },
        staleCheckpoint: true,
      };
    }
    return { kind: 'completed', state: { ...state, phase: 'completed' }, staleCheckpoint: true };
  }
  if (saved.phase === 'partial' && saved.synthesisFailure) {
    return { kind: 'partial', state: saved, staleCheckpoint: false };
  }

  const start = events.find((event) => event.type === 'run_started');
  const plan = events.find((event) => event.type === 'plan_validated')?.payload;
  const recovery = events.find((event) => event.type === 'recovery_plan_validated')?.payload;
  if (!start) throw new Error('worker resume requires a recorded accepted plan or saved planner response');

  // Resume uses the saved input bytes, even if the source repo has changed.
  const documents = start.payload.documents.map((document) => {
    // Use the SAME basename transformation as RunLedger.writeArtifact().
    // Otherwise an unusual document id would be written successfully but
    // resume would look for a different filename.
    const inputName = safeArtifactName(`input-${document.id}`) + '.json';
    const input = JSON.parse(fs.readFileSync(path.join(ledger.artifactDir, inputName), 'utf8'));
    return { ...input, relativePath: input.path };
  });
  const inputHash = inputContentHash(contentHash, objective, documents);
  const pending = {};
  for (const [phaseLabel, acceptedEvent] of [
    ['plan', 'plan_validated'],
    ['recover', 'recovery_plan_validated'],
  ]) {
    pending[phaseLabel] =
      planSource === 'starlark'
        ? pendingPlannerResponse({ events, ledger, phaseLabel, acceptedEvent, plannerLadder, inputHash })
        : null;
  }
  if (!plan && !pending.plan)
    throw new Error('worker resume requires a recorded accepted plan or saved planner response');
  if (plan?.hashes && (plan.hashes.inputHash !== inputHash || plan.hashes.planHash !== contentHash(plan.jobs))) {
    throw new Error('saved plan/input content hash mismatch; refusing worker resume');
  }
  if (recovery?.hashes && recovery.hashes.planHash !== contentHash(recovery.jobs)) {
    throw new Error('saved recovery plan content hash mismatch; refusing worker resume');
  }

  // Hashes are an integrity check, not a replacement for validateJobs.
  const policy = policyFor(documents.map(publicDocument));
  if (plan) validateJobs(plan.jobs, policy, 'plan');
  if (recovery) {
    validateJobs(
      recovery.jobs,
      {
        ...policy,
        exactJobs: undefined,
        requireAllInputs: false,
        failedJobIds: events
          .filter((event) => event.type === 'job_failed' && event.payload.error.retryable)
          .map((event) => event.payload.jobId),
      },
      'recovery',
    );
  }

  // Terminal receipts become the results the coordinator reuses verbatim.
  const jobs = new Map([...(plan?.jobs || []), ...(recovery?.jobs || [])].map((job) => [job.id, job]));
  const results = new Map();
  for (const event of events) {
    if (!['job_succeeded', 'job_failed'].includes(event.type)) continue;
    const receipt = event.payload;
    const job = jobs.get(receipt.jobId);
    if (!job || results.has(job.id)) throw new Error('run ledger has an unknown or duplicate terminal job receipt');
    if (event.type === 'job_succeeded') {
      const artifactPath = path.resolve(ledger.runDir, receipt.artifact);
      if (!artifactPath.startsWith(ledger.artifactDir + path.sep))
        throw new Error('worker artifact escapes run artifacts');
      const output = parseWorkerOutput(fs.readFileSync(artifactPath, 'utf8'));
      results.set(job.id, {
        ok: true,
        job,
        attempt: receipt.attempt,
        artifact: receipt.artifact,
        output,
        usage: receipt.usage,
        costUsd: receipt.costUsd,
      });
    } else {
      results.set(job.id, {
        ok: false,
        job,
        attempt: receipt.attempt,
        error: receipt.error,
        charged: receipt.charged,
      });
    }
  }

  // Recovery's inputs include the initial failure records as well as files.
  const failures = (plan?.jobs || [])
    .map((job) => results.get(job.id))
    .filter((result) => result && !result.ok)
    .map((result) => ({
      job_id: result.job.id,
      worker: result.job.worker,
      task: result.job.task,
      input_ids: result.job.input_ids,
      retryable: result.error.retryable,
      code: result.error.code,
    }));
  // Verify the pending evaluation's inputs before resume appends any events.
  // Recovery sees only the original plan's failure records, in plan order.
  for (const label of ['plan', 'recover']) {
    if (!pending[label]) continue;
    const isRecovery = label === 'recover';
    const context = { objective, documents: documents.map(publicDocument), ...(isRecovery ? { failures } : {}) };
    const evaluationPolicy = isRecovery
      ? {
          ...policy,
          failedJobIds: failures.filter((failure) => failure.retryable).map((failure) => failure.job_id),
          exactJobs: undefined,
          requireAllInputs: false,
        }
      : policy;
    const expected = contentHash({
      context,
      policy: evaluationPolicy,
      functionName: label,
      validationPhase: isRecovery ? 'recovery' : 'plan',
    });
    if (pending[label].evaluationHash !== expected) {
      throw new Error('saved planner evaluation context/policy mismatch; refusing resume');
    }
  }
  for (const [label, accepted, phaseFailures] of [
    ['plan', plan, null],
    ['recover', recovery, failures],
  ]) {
    if (!accepted?.hashes) continue; // Older pre-hash evidence is still resumable.
    const program =
      planSource === 'host_json'
        ? null
        : JSON.parse(fs.readFileSync(path.join(ledger.artifactDir, `${label}-source-accepted.json`), 'utf8')).source;
    const expected = acceptedPlanHashes({ jobs: accepted.jobs, program, failures: phaseFailures, inputHash });
    if (contentHash(accepted.hashes) !== contentHash(expected)) {
      throw new Error('saved accepted program/input content hash mismatch; refusing worker resume');
    }
  }

  // Synthesis (and any recovery planning still owed) runs on the ladder tier
  // that last produced an accepted program.
  let activePlannerModel =
    pending.recover?.model || pending.plan?.model || recovery?.metrics?.model || plan?.metrics?.model || plannerModel;
  if (activePlannerModel === 'host_json') activePlannerModel = plannerModel;
  return {
    kind: 'workers',
    state: saved,
    documents,
    inputHash,
    activePlannerModel,
    ladderIndex:
      pending.recover?.ladderIndex ??
      pending.plan?.ladderIndex ??
      Math.max(0, plannerLadder.indexOf(activePlannerModel)),
    resumeData: { plan, recovery, results, pending },
  };
}

module.exports = { restoreWorkerRun, restoreSynthesisResume };
