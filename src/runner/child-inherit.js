'use strict';

/**
 * child-inherit.js — Parent → child runtime inheritance (P1-10).
 *
 * spawn_agent / WorkerRuntime used to launch children as quiet, almost-empty
 * CLI invocations (cwd + tools + steps only). That meant delegated work could
 * silently use a different model, skip --no-network, omit traces, and leave
 * the parent unable to account for child requests.
 *
 * This module builds a narrow inherit bag from the parent run, applies it as
 * CLI flags / env on the child argv, and shapes a child manifest the parent
 * can attach to its final result and ledger.
 *
 * Authority still narrows via authority.js — inherit never widens shell/edits.
 * Secrets: caller tokens travel via BRIDGE_CALLER_TOKEN env only, never argv.
 */

/**
 * Build the inherit bag from parent run context. `live` may supply remaining
 * wall-clock budget computed at spawn time.
 */
function buildChildInheritSpec(ctx, live = {}) {
  const src = (ctx && ctx.childInherit) || {};
  const inherit = {
    model: src.model || null,
    effort: src.effort || null,
    thinking: src.thinking || null,
    bridgeUrl: src.bridgeUrl || null,
    noNetwork: !!(src.noNetwork || (ctx && ctx.noNetwork)),
    maxWallClockMs:
      typeof live.maxWallClockMs === 'number'
        ? live.maxWallClockMs
        : typeof src.maxWallClockMs === 'number'
          ? src.maxWallClockMs
          : null,
    maxCostUsd: typeof src.maxCostUsd === 'number' ? src.maxCostUsd : null,
    temperature: typeof src.temperature === 'number' ? src.temperature : null,
    traceLevel: src.traceLevel && src.traceLevel !== 'off' ? src.traceLevel : null,
    parentRunId: src.parentRunId || null,
    // Never put the raw token in the bag that may be logged — only a boolean.
    hasCallerToken: !!src.hasCallerToken,
  };
  return inherit;
}

/**
 * Append inherit flags to a child argv array. Mutates and returns `args`.
 */
function applyInheritToArgs(args, inherit) {
  if (!inherit) return args;
  if (inherit.model) args.push('--model', String(inherit.model));
  if (inherit.effort) args.push('--effort', String(inherit.effort));
  if (inherit.thinking) args.push('--thinking', String(inherit.thinking));
  if (inherit.bridgeUrl) args.push('--bridge-url', String(inherit.bridgeUrl));
  if (inherit.noNetwork) args.push('--no-network');
  if (typeof inherit.maxWallClockMs === 'number' && inherit.maxWallClockMs > 0) {
    args.push('--max-wall-clock-ms', String(Math.floor(inherit.maxWallClockMs)));
  }
  if (typeof inherit.maxCostUsd === 'number' && inherit.maxCostUsd > 0) {
    args.push('--max-cost-usd', String(inherit.maxCostUsd));
  }
  if (typeof inherit.temperature === 'number') {
    args.push('--temperature', String(inherit.temperature));
  }
  if (inherit.traceLevel) {
    args.push('--trace-level', String(inherit.traceLevel));
  }
  return args;
}

/**
 * Env vars for correlation and caller-token inheritance (never put token in argv).
 */
function applyInheritToEnv(env, inherit, options = {}) {
  const out = { ...env };
  if (inherit && inherit.parentRunId) {
    out.BRIDGE_RUNNER_PARENT_RUN_ID = String(inherit.parentRunId);
  }
  if (options.workerId) {
    out.BRIDGE_RUNNER_WORKER_ID = String(options.workerId);
  }
  if (options.callerToken) {
    out.BRIDGE_CALLER_TOKEN = String(options.callerToken);
  }
  return out;
}

/**
 * Build a compact, redaction-safe child manifest for parent accounting.
 */
function buildChildManifest({ workerResult, inherit, leaseId, phase }) {
  const usage = workerResult && workerResult.usage ? workerResult.usage : null;
  const events = Array.isArray(workerResult && workerResult.events) ? workerResult.events : [];
  const toolEffects = events
    .filter((e) => e && (e.type === 'tool_effect_result' || e.type === 'tool_result' || e.tool))
    .slice(0, 50)
    .map((e) => ({
      type: e.type || 'tool',
      tool: e.tool || e.name || null,
      ok: e.ok !== undefined ? e.ok : null,
    }));

  return {
    workerId: (workerResult && workerResult.workerId) || null,
    phase: phase || (workerResult && workerResult.phase) || null,
    state: (workerResult && workerResult.state) || null,
    stopReason: (workerResult && workerResult.stopReason) || null,
    exitCode: workerResult && typeof workerResult.exitCode === 'number' ? workerResult.exitCode : null,
    duration_ms: (workerResult && workerResult.duration_ms) || null,
    usage,
    leaseId: leaseId || null,
    inherited: inherit
      ? {
          model: inherit.model,
          effort: inherit.effort,
          thinking: inherit.thinking,
          bridgeUrl: inherit.bridgeUrl ? '[set]' : null,
          noNetwork: !!inherit.noNetwork,
          maxWallClockMs: inherit.maxWallClockMs,
          maxCostUsd: inherit.maxCostUsd,
          temperature: inherit.temperature,
          traceLevel: inherit.traceLevel,
          parentRunId: inherit.parentRunId,
          hasCallerToken: !!inherit.hasCallerToken,
        }
      : null,
    toolEffects,
    // finalText is summarized, not duplicated verbatim (parent already has tool result text).
    summary: ((workerResult && (workerResult.summary || workerResult.finalText)) || '').slice(0, 2000),
  };
}

module.exports = {
  buildChildInheritSpec,
  applyInheritToArgs,
  applyInheritToEnv,
  buildChildManifest,
};
