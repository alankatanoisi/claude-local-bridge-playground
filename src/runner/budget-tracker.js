'use strict';

/**
 * budget-tracker.js — Live token/wall/spawn budget telemetry for runner sessions.
 *
 * Hard caps stop the run at loop boundaries. Soft caps (80% of hard cap) emit
 * structured warnings once per dimension until the hard cap fires.
 */

const { STOP_REASONS } = require('./kernel/contract');

const DEFAULT_SOFT_RATIO = 0.8;

function parseCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function createBudgetTracker(options = {}) {
  const startedAt = options.startedAt || Date.now();
  const hardInput = parseCap(options.budgetInputTokens);
  const hardOutput = parseCap(options.budgetOutputTokens);
  const softInput =
    parseCap(options.budgetInputTokensSoft) ||
    (hardInput ? Math.max(1, Math.floor(hardInput * DEFAULT_SOFT_RATIO)) : null);
  const softOutput =
    parseCap(options.budgetOutputTokensSoft) ||
    (hardOutput ? Math.max(1, Math.floor(hardOutput * DEFAULT_SOFT_RATIO)) : null);

  const warned = { input: false, output: false };
  let parentInputRemaining = hardInput;
  let parentOutputRemaining = hardOutput;

  if (options.parentRemaining) {
    if (typeof options.parentRemaining.input_tokens === 'number') {
      parentInputRemaining = parseCap(options.parentRemaining.input_tokens);
    }
    if (typeof options.parentRemaining.output_tokens === 'number') {
      parentOutputRemaining = parseCap(options.parentRemaining.output_tokens);
    }
  }

  const effectiveHardInput =
    hardInput !== null && parentInputRemaining !== null
      ? Math.min(hardInput, parentInputRemaining)
      : (hardInput ?? parentInputRemaining);
  const effectiveHardOutput =
    hardOutput !== null && parentOutputRemaining !== null
      ? Math.min(hardOutput, parentOutputRemaining)
      : (hardOutput ?? parentOutputRemaining);

  const effectiveSoftInput =
    softInput !== null && effectiveHardInput !== null ? Math.min(softInput, effectiveHardInput) : softInput;
  const effectiveSoftOutput =
    softOutput !== null && effectiveHardOutput !== null ? Math.min(softOutput, effectiveHardOutput) : softOutput;

  function remainingBudget() {
    return {
      input_tokens: effectiveHardInput,
      output_tokens: effectiveHardOutput,
    };
  }

  function remainingAfterUsage(totalUsage) {
    const inputUsed = totalUsage?.input_tokens || 0;
    const outputUsed = totalUsage?.output_tokens || 0;
    return {
      input_tokens: effectiveHardInput !== null ? Math.max(0, effectiveHardInput - inputUsed) : null,
      output_tokens: effectiveHardOutput !== null ? Math.max(0, effectiveHardOutput - outputUsed) : null,
    };
  }

  function snapshot(totalUsage, ctx) {
    return {
      type: 'budget',
      input_tokens: totalUsage.input_tokens || 0,
      output_tokens: totalUsage.output_tokens || 0,
      wall_ms: Date.now() - startedAt,
      spawns: ctx?.spawnCount || 0,
      depth: ctx?.spawnDepth || 0,
      caps: {
        input_tokens: effectiveHardInput,
        output_tokens: effectiveHardOutput,
      },
    };
  }

  function evaluate(totalUsage, ctx) {
    const inputTokens = totalUsage.input_tokens || 0;
    const outputTokens = totalUsage.output_tokens || 0;
    const event = snapshot(totalUsage, ctx);
    const warnings = [];

    if (effectiveHardInput !== null && inputTokens >= effectiveHardInput) {
      return {
        event,
        stop: STOP_REASONS.INPUT_TOKEN_BUDGET_EXCEEDED,
        message: 'Input token budget exceeded (' + inputTokens + ' >= ' + effectiveHardInput + ')',
      };
    }
    if (effectiveHardOutput !== null && outputTokens >= effectiveHardOutput) {
      return {
        event,
        stop: STOP_REASONS.OUTPUT_TOKEN_BUDGET_EXCEEDED,
        message: 'Output token budget exceeded (' + outputTokens + ' >= ' + effectiveHardOutput + ')',
      };
    }

    if (effectiveSoftInput !== null && !warned.input && inputTokens >= effectiveSoftInput) {
      warned.input = true;
      warnings.push({
        kind: 'input_tokens',
        message:
          'Approaching input token budget (' +
          inputTokens +
          ' / ' +
          effectiveHardInput +
          ' hard cap; soft warning at ' +
          effectiveSoftInput +
          ')',
        stopReason: 'predictive_input_token_budget_exceeded',
      });
    }
    if (effectiveSoftOutput !== null && !warned.output && outputTokens >= effectiveSoftOutput) {
      warned.output = true;
      warnings.push({
        kind: 'output_tokens',
        message:
          'Approaching output token budget (' +
          outputTokens +
          ' / ' +
          effectiveHardOutput +
          ' hard cap; soft warning at ' +
          effectiveSoftOutput +
          ')',
        stopReason: 'predictive_output_token_budget_exceeded',
      });
    }

    return { event, warnings };
  }

  return {
    snapshot,
    evaluate,
    remainingBudget,
    remainingAfterUsage,
    effectiveHardInput,
    effectiveHardOutput,
  };
}

module.exports = {
  DEFAULT_SOFT_RATIO,
  createBudgetTracker,
  parseCap,
};
