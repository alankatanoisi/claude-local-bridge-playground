'use strict';

/**
 * evaluation-harness.js — R4: repeated trials with a deterministic rubric.
 *
 * The 2026-08-06 planner comparison was five single trials, and the live
 * results doc itself warned they "are not statistically meaningful rankings."
 * This harness makes repetition cheap and scoring mechanical, so model
 * rankings come from data rather than reputation.
 *
 * Deliberately THIN (N-2: no third orchestration harness): each trial is the
 * same PhasedCoordinator run the canary and workflow commands use, on the
 * same fixture documents and deterministic fault profile. The harness only
 * adds (a) the repeat loop, (b) per-run cost deltas against the shared
 * durable campaign budget, and (c) a scorer that reads what the run already
 * recorded — state.json and events.jsonl — never private coordinator state.
 *
 * Rubric per run (from the live-results doc + R6's repair-tax metric):
 *   first-pass validity, repair success, lint repairs/rejects, rejection
 *   classes (with forbidden-authority field detection), retry correctness
 *   against the injected-fault profile, accepted artifacts, synthesis state,
 *   latency, per-run estimated cost, trace completeness.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ClaudeBridge, CostBudget, MockBridge } = require('./bridge');
const { PhasedCoordinator, loadDocuments } = require('./coordinator');

const AUTHORITY_FIELDS = ['model', 'provider', 'shell', 'command', 'path', 'url', 'load'];

/**
 * Classify one *_rejected ledger event into a deterministic rejection class.
 *
 * RunLedger nests everything the coordinator passes under `payload` (unlike
 * the runner's SessionLedger, which spreads it at top level). Reading the
 * wrong shape here does not throw — it silently classifies every rejection as
 * 'other', which is why this accessor is explicit and the tests build events
 * through the real ledger instead of hand-written flat objects.
 */
function classifyRejection(event) {
  const payload = event && event.payload ? event.payload : event || {};
  const message = payload.error || '';
  if (payload.lintRules && payload.lintRules.length) return { class: 'lint_reject', rules: payload.lintRules };
  const unknownField = message.match(/unknown field '([^']+)'/);
  if (unknownField) {
    return {
      class: 'unknown_field',
      field: unknownField[1],
      authority: AUTHORITY_FIELDS.includes(unknownField[1].toLowerCase()),
    };
  }
  if (/timeout is outside policy|max_output_tokens is outside policy|task must be/.test(message)) {
    return { class: 'bounds_violation' };
  }
  if (/job count|covered exactly once|exceeds phase limit/.test(message)) {
    return { class: 'count_violation' };
  }
  // Observed live 2026-08-10 (Sonnet 5 recovery, 4 of 5 trials): the program
  // evaluates fine but returns something other than a list of job dicts.
  // That is a distinct planner failure mode from a Starlark error, so it gets
  // its own class rather than being lumped into 'other'.
  if (/must be a list of job descriptors|must be an object/.test(message)) {
    return { class: 'result_shape' };
  }
  if (/Starlark (module|function|evaluation)/.test(message)) {
    return { class: 'starlark_error' };
  }
  return { class: 'other' };
}

function readEvents(runDir) {
  const eventsPath = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return [];
  return fs
    .readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Upstream calls made by ONE run, derived from its own durable record.
 *
 * Do NOT use budget.calls.length here: with the durable campaign budget that
 * array is campaign-cumulative across every trial, so an expected-events
 * figure built from it grows monotonically and turns trace completeness into
 * a meaningless (always-failing) metric. Everything needed is already in the
 * run's state: plan/recovery attempts each cost one call, a worker result
 * cost a call only if it succeeded or was recorded as charged (the fault
 * profile's before-call injections never reach the network), and R10 records
 * the synthesis call count including map-reduce fan-out.
 */
function upstreamCallsForRun(state) {
  const planCalls = state.planMetrics ? state.planMetrics.attempts : 0;
  const recoveryCalls = state.recoveryMetrics ? state.recoveryMetrics.attempts : 0;
  const workerCalls = (state.results || []).filter((result) => result.ok || result.charged).length;
  const synthesisCalls = state.synthesisCalls || 0;
  return planCalls + recoveryCalls + workerCalls + synthesisCalls;
}

/** Count trace events in a bridge trace file. Aggregate count only. */
function traceCompleteness(traceMetadata, settledCalls) {
  if (!traceMetadata || !traceMetadata.bridgeTracePath) return { checked: false };
  let lines = 0;
  try {
    lines = fs.readFileSync(traceMetadata.bridgeTracePath, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return { checked: true, present: false };
  }
  // The bridge writes 5 events per completed upstream call.
  const expected = settledCalls * 5;
  return { checked: true, present: true, events: lines, expected, complete: lines >= expected };
}

/**
 * Score one finished (or failed) run from its durable record.
 * `state` is the coordinator's final state; `runDir` supplies events.jsonl.
 */
function scoreRun({ state, runDir, costUsd, durationMs, traceMetadata }) {
  const events = readEvents(runDir);
  // The coordinator labels its two planning phases 'plan' and 'recover', so
  // the recovery rejection event is `recover_rejected`. Matching on the
  // generic suffix (rather than a hand-written list that once said
  // 'recovery_rejected') keeps this from silently scoring zero rejections
  // for a phase that actually rejected — a false-green in the scorer itself.
  const rejections = events
    .filter((event) => typeof event.type === 'string' && event.type.endsWith('_rejected'))
    .map((event) => ({ phase: event.type.replace(/_rejected$/, ''), ...classifyRejection(event) }));

  const results = state.results || [];
  const firstAttempt = results.filter((result) => result.attempt === 1);
  const retries = results.filter((result) => result.attempt === 2);
  const retryableFailures = firstAttempt.filter((result) => !result.ok && result.error?.retryable).length;
  const permanentFailures = firstAttempt.filter((result) => !result.ok && !result.error?.retryable).length;
  // Validator already refuses retries of permanent failures; recording it
  // keeps "retry correctness" an observed number, not an assumption.
  const permanentRetried = retries.filter(
    (retry) => !firstAttempt.some((first) => first.job.id === retry.job.retry_of && first.error?.retryable),
  ).length;

  const settledCalls = upstreamCallsForRun(state);
  return {
    phase: state.phase,
    planFirstPassValid: state.planMetrics ? state.planMetrics.firstPassValid : false,
    planAttempts: state.planMetrics ? state.planMetrics.attempts : 0,
    planLintFixes: state.planMetrics ? state.planMetrics.lintFixes || 0 : 0,
    recoveryFirstPassValid: state.recoveryMetrics ? state.recoveryMetrics.firstPassValid : null,
    recoveryAttempts: state.recoveryMetrics ? state.recoveryMetrics.attempts : 0,
    rejections,
    authorityAttempts: rejections.filter((rejection) => rejection.authority).length,
    retryableFailures,
    permanentFailures,
    retriesProposed: retries.length,
    retriesSucceeded: retries.filter((retry) => retry.ok).length,
    permanentRetried,
    acceptedArtifacts: results.filter((result) => result.ok).length,
    synthesisState: state.synthesisFailure ? state.synthesisFailure.code : state.phase === 'failed' ? null : 'completed',
    synthesisStrategy: state.synthesisStrategy || null,
    error: state.error || null,
    durationMs,
    costUsd,
    trace: traceCompleteness(traceMetadata, settledCalls),
  };
}

function makeRunDir(root, model, rep) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}__${model}__rep${rep}__${crypto.randomUUID().slice(0, 8)}`.replace(
    /[^a-zA-Z0-9._-]/g,
    '_',
  );
  const runDir = path.join(root, name);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  return runDir;
}

/**
 * Run `reps` sequential trials for each model. Sequential on purpose: the
 * shared campaign budget makes per-run cost a clean before/after delta only
 * when this process is the campaign's sole writer during a trial.
 */
async function runRepeatedTrials({
  config,
  models,
  reps,
  mode = 'live',
  budget,
  faultProfile = 'mixed',
  traceLevel = 'full',
  evalRoot,
  // axis 'planner' varies the planner with workers fixed (R4); axis 'worker'
  // varies the worker with the planner fixed. Exactly one axis moves per
  // evaluation so a difference is always attributable.
  axis = 'planner',
  plannerModel = config.fixedPlannerModel,
  workerModel = config.fixedWorkerModel,
  onTrialComplete = () => {},
}) {
  fs.mkdirSync(evalRoot, { recursive: true, mode: 0o700 });
  const trials = [];
  for (const model of models) {
    const trialPlanner = axis === 'planner' ? model : plannerModel;
    const trialWorker = axis === 'worker' ? model : workerModel;
    for (let rep = 1; rep <= reps; rep += 1) {
      const runDir = makeRunDir(evalRoot, model, rep);
      const traceId = `eval-${crypto.randomUUID()}`;
      const bridge =
        mode === 'live'
          ? new ClaudeBridge({
              runnerRepo: config.runnerRepo,
              bridgeUrl: config.bridgeUrl,
              callerToken: process.env.BRIDGE_CALLER_TOKEN,
              budget,
              effort: config.effort,
              traceLevel,
              traceId,
              runId: traceId,
            })
          : new MockBridge({ budget });
      const coordinator = new PhasedCoordinator({
        config,
        bridge,
        plannerModel: trialPlanner,
        workerModel: trialWorker,
        faultProfile,
        runDir,
        documents: loadDocuments(config),
      });
      const costBefore = budget.usedUsd;
      const started = Date.now();
      let state;
      try {
        state = await coordinator.run();
      } catch (error) {
        coordinator.state.phase = 'failed';
        coordinator.state.error = { name: error.name, message: error.message };
        coordinator.ledger.append('run_failed', coordinator.state.error);
        coordinator.checkpoint();
        state = coordinator.state;
      }
      const trial = {
        model,
        axis,
        plannerModel: trialPlanner,
        workerModel: trialWorker,
        rep,
        runDir,
        score: scoreRun({
          state,
          runDir,
          costUsd: Number((budget.usedUsd - costBefore).toFixed(6)),
          durationMs: Date.now() - started,
          traceMetadata: bridge.traceMetadata ? bridge.traceMetadata() : null,
        }),
      };
      trials.push(trial);
      onTrialComplete(trial);
    }
  }
  return trials;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(3));
}

function mean(values) {
  return values.length === 0 ? null : Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3));
}

/** Aggregate trial scores into one per-model summary table. */
function aggregate(trials) {
  const byModel = new Map();
  for (const trial of trials) {
    if (!byModel.has(trial.model)) byModel.set(trial.model, []);
    byModel.get(trial.model).push(trial.score);
  }
  const summary = {};
  for (const [model, scores] of byModel) {
    const n = scores.length;
    summary[model] = {
      trials: n,
      completedRuns: scores.filter((score) => score.phase === 'completed').length,
      partialRuns: scores.filter((score) => score.phase === 'partial').length,
      failedRuns: scores.filter((score) => score.phase === 'failed').length,
      planFirstPassRate: ratio(scores.filter((score) => score.planFirstPassValid).length, n),
      recoveryFirstPassRate: ratio(
        scores.filter((score) => score.recoveryFirstPassValid === true).length,
        scores.filter((score) => score.recoveryFirstPassValid !== null).length,
      ),
      lintFixesTotal: scores.reduce((sum, score) => sum + score.planLintFixes, 0),
      rejectionClasses: scores
        .flatMap((score) => score.rejections)
        .reduce((counts, rejection) => {
          counts[rejection.class] = (counts[rejection.class] || 0) + 1;
          return counts;
        }, {}),
      authorityAttempts: scores.reduce((sum, score) => sum + score.authorityAttempts, 0),
      permanentRetried: scores.reduce((sum, score) => sum + score.permanentRetried, 0),
      meanRetriesSucceeded: mean(scores.map((score) => score.retriesSucceeded)),
      meanAcceptedArtifacts: mean(scores.map((score) => score.acceptedArtifacts)),
      synthesisOutcomes: scores.reduce((counts, score) => {
        const key = score.synthesisState || 'none';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      meanDurationMs: mean(scores.map((score) => score.durationMs)),
      meanCostUsd: mean(scores.map((score) => score.costUsd)),
      minCostUsd: n ? Math.min(...scores.map((score) => score.costUsd)) : null,
      maxCostUsd: n ? Math.max(...scores.map((score) => score.costUsd)) : null,
      tracesComplete: scores.filter((score) => score.trace && score.trace.complete).length,
    };
  }
  return summary;
}

module.exports = {
  AUTHORITY_FIELDS,
  aggregate,
  classifyRejection,
  upstreamCallsForRun,
  makeEvalRoot: (root) => path.join(root ?? os.tmpdir(), 'eval-runs'),
  runRepeatedTrials,
  scoreRun,
};
