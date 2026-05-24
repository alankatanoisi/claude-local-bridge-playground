'use strict';

/**
 * AgentKernel contract — deterministic turn engine boundary.
 *
 * The kernel owns: model loop, tool dispatch, permission gate, stop guards, events.
 * It does NOT own: orchestration phases, subagent lifecycle, compaction policy (coordinator).
 */

/** Why a kernel run ended. Stable machine-readable taxonomy. */
const STOP_REASONS = Object.freeze({
  SUCCESS: 'success',
  MAX_STEPS: 'max_steps',
  MAX_TOOL_CALLS_PER_TURN: 'max_tool_calls_per_turn',
  CONTEXT_BUDGET_EXCEEDED: 'context_budget_exceeded',
  BRIDGE_ERROR: 'bridge_error',
  CWD_INVALID: 'cwd_invalid',
  RESUME_FAILED: 'resume_failed',
  USER_DENIED: 'user_denied',
  TOOL_FAILURE_ESCALATION: 'tool_failure_escalation',
  CANCELLED: 'cancelled',
  WORKSPACE_NOT_TRUSTED: 'workspace_not_trusted',
  SEMANTIC_CYCLE_DETECTED: 'semantic_cycle_detected',
  WALL_CLOCK_BUDGET_EXCEEDED: 'wall_clock_budget_exceeded',
  COST_BUDGET_EXCEEDED: 'cost_budget_exceeded',
  PREDICTIVE_CONTEXT_BUDGET_EXCEEDED: 'predictive_context_budget_exceeded',
  RETRY_BUDGET_EXCEEDED: 'retry_budget_exceeded',
});

/** Subset emitted on stream-json / automation surfaces. */
const KERNEL_EVENT_TYPES = Object.freeze([
  'system',
  'model_request',
  'assistant',
  'tool_use',
  'tool_result',
  'approval_required',
  'error',
  'result',
  'compaction',
]);

/**
 * @typedef {Object} KernelUsage
 * @property {number} input_tokens
 * @property {number} output_tokens
 * @property {number} [cache_read_input_tokens]
 * @property {number} [cache_creation_input_tokens]
 */

/**
 * @typedef {Object} KernelResult
 * @property {string} stopReason — one of STOP_REASONS
 * @property {string} [finalText]
 * @property {number} steps
 * @property {number} duration_ms
 * @property {KernelUsage} usage
 * @property {object[]} events
 * @property {boolean} [streamed]
 * @property {string} [runId]
 * @property {number} [exitCode]
 */

/**
 * @typedef {Object} KernelInput
 * @property {string} prompt
 * @property {string} [stdinText]
 * @property {string} cwd
 * @property {string} model
 * @property {number} maxTokens
 * @property {number} [maxSteps]
 * @property {string} [outputFormat] — text | json | stream-json
 * @property {string} [sessionId] — canonical session store id
 * @property {string} [sessionPath] — flat JSON session file path
 * @property {boolean} [resume]
 * @property {string} [transcriptPath]
 * @property {string} [bridgeUrl]
 * @property {string} [callerToken]
 * @property {boolean} [acceptEdits]
 * @property {boolean} [dontAsk]
 * @property {boolean} [allowShell]
 * @property {boolean} [plan]
 * @property {Set<string>|string[]|null} [allowedTools]
 * @property {number} [maxContextTokens]
 * @property {number} [maxToolCallsPerTurn]
 * @property {string} [traceLevel]
 * @property {string} [tracePath]
 * @property {string} [runId]
 * @property {boolean} [verbose]
 * @property {boolean} [quiet]
 * @property {boolean} [stream]
 * @property {string} [systemPromptOverride]
 */

function emptyUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

/**
 * Normalize legacy run() return shape into KernelResult.
 * @param {object|null|undefined} raw
 * @param {object} [meta]
 * @returns {KernelResult|null}
 */
function normalizeKernelResult(raw, meta = {}) {
  if (!raw) return null;

  const exitCode = meta.exitCode ?? (raw.stopReason === STOP_REASONS.SUCCESS ? 0 : 1);
  let stopReason = raw.stopReason || meta.stopReason;

  if (!stopReason) {
    const text = raw.finalText || '';
    if (text.includes('Reached max_steps')) stopReason = STOP_REASONS.MAX_STEPS;
    else if (text.includes('Context token budget exceeded')) stopReason = STOP_REASONS.CONTEXT_BUDGET_EXCEEDED;
    else if (text.includes('Tool call limit exceeded')) stopReason = STOP_REASONS.MAX_TOOL_CALLS_PER_TURN;
    else if (text.includes('User denied')) stopReason = STOP_REASONS.USER_DENIED;
    else if (text.includes('consecutive tool failures')) stopReason = STOP_REASONS.TOOL_FAILURE_ESCALATION;
    else if (exitCode === 0) stopReason = STOP_REASONS.SUCCESS;
    else stopReason = STOP_REASONS.BRIDGE_ERROR;
  }

  return {
    stopReason,
    finalText: raw.finalText,
    steps: raw.steps ?? meta.steps ?? 0,
    duration_ms: raw.duration_ms ?? 0,
    usage: raw.usage || emptyUsage(),
    events: raw.events || [],
    streamed: raw.streamed,
    runId: meta.runId,
    exitCode,
  };
}

function isStopReason(value) {
  return Object.values(STOP_REASONS).includes(value);
}

module.exports = {
  STOP_REASONS,
  KERNEL_EVENT_TYPES,
  emptyUsage,
  normalizeKernelResult,
  isStopReason,
};
