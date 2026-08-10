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

/** Classify one *_rejected ledger event into a deterministic rejection class. */
function classifyRejection(event) {
  const message = event.error || '';
  if (event.lintRules && event.lintRules.length) return { class: 'lint_reject', rules: event.lintRules };
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
  const rejections = events
    .filter((event) => event.type === 'plan_rejected' || event.type === 'recovery_rejected')
    .map((event) => ({ phase: event.type.replace('_rejected', ''), ...classifyRejection(event) }));

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

  const settledCalls = (state.cost?.calls || []).length;
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
  workerModel = config.fixedWorkerModel,
  onTrialComplete = () => {},
}) {
  fs.mkdirSync(evalRoot, { recursive: true, mode: 0o700 });
  const trials = [];
  for (const model of models) {
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
        plannerModel: model,
        workerModel,
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
  makeEvalRoot: (root) => path.join(root ?? os.tmpdir(), 'eval-runs'),
  runRepeatedTrials,
  scoreRun,
};
