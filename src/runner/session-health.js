'use strict';

/**
 * Session health — resume guardrails and fresh-session recommendations.
 */

const { STOP_REASONS } = require('./kernel/contract');

const DEGRADED_STOP_REASONS = new Set([
  STOP_REASONS.SEMANTIC_CYCLE_DETECTED,
  STOP_REASONS.MAX_STEPS,
  STOP_REASONS.CONTEXT_BUDGET_EXCEEDED,
  STOP_REASONS.TOOL_FAILURE_ESCALATION,
  STOP_REASONS.BRIDGE_ERROR,
]);

const MAX_COMPACTION_GENERATION = 5;
const MAX_CONSECUTIVE_TOOL_FAILURES = 3;

const RECOMMENDATIONS = Object.freeze({
  FRESH_SESSION: 'fresh_session',
  RESUME_OK: 'resume_ok',
});

const PLAYBOOK_DOC = 'lab-notes/runner-megathread-playbook.md';

function getHealth(sessionStore) {
  if (!sessionStore) return null;
  const runner = sessionStore.data().runner || {};
  return runner.health || null;
}

function isDegraded(health) {
  return !!(health && health.degraded);
}

/**
 * Build health snapshot from a completed run.
 */
function buildHealth(input) {
  const { stopReason, autopsy, compactionGeneration = 0, consecutiveToolFailures = 0 } = input || {};

  const reasons = [];
  if (stopReason && DEGRADED_STOP_REASONS.has(stopReason)) {
    reasons.push(stopReason);
  }
  if (autopsy?.cycleDetected && !reasons.includes(STOP_REASONS.SEMANTIC_CYCLE_DETECTED)) {
    reasons.push(STOP_REASONS.SEMANTIC_CYCLE_DETECTED);
  }
  if (compactionGeneration >= MAX_COMPACTION_GENERATION) {
    reasons.push('compaction_generation_high');
  }
  if (consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES) {
    reasons.push('consecutive_tool_failures');
  }

  const degraded = reasons.length > 0;
  return {
    degraded,
    reasons,
    lastStopReason: stopReason || null,
    lastRunAt: new Date().toISOString(),
    compactionGeneration,
    recommendation: degraded ? RECOMMENDATIONS.FRESH_SESSION : RECOMMENDATIONS.RESUME_OK,
  };
}

function assertResumeAllowed(sessionStore, options = {}) {
  const health = getHealth(sessionStore);
  if (!isDegraded(health)) {
    return { allowed: true, health };
  }
  if (options.ackResumeRisk) {
    return { allowed: true, health, acknowledged: true };
  }
  return {
    allowed: false,
    health,
    message: formatResumeBlockedMessage(health),
  };
}

function formatResumeBlockedMessage(health) {
  const reasons = (health?.reasons || []).join(', ') || 'unknown';
  return (
    'Session health is degraded (' +
    reasons +
    '). Start fresh with --new-session or pass --ack-resume-risk to resume anyway. See ' +
    PLAYBOOK_DOC +
    '.'
  );
}

function formatFreshSessionTip(sessionId) {
  const idPart = sessionId ? ' --session-id ' + sessionId : '';
  return (
    'Next task: node bin/local-bridge-runner.js --new-session' +
    idPart +
    ' --task-scope --plan "…" (see ' +
    PLAYBOOK_DOC +
    ')'
  );
}

function formatTaskScopeEndTip() {
  return (
    'Task done — start the next task with --new-session (or --fork-from <session-id> to branch). See ' +
    PLAYBOOK_DOC +
    '.'
  );
}

module.exports = {
  DEGRADED_STOP_REASONS,
  MAX_COMPACTION_GENERATION,
  RECOMMENDATIONS,
  PLAYBOOK_DOC,
  getHealth,
  isDegraded,
  buildHealth,
  assertResumeAllowed,
  formatResumeBlockedMessage,
  formatFreshSessionTip,
  formatTaskScopeEndTip,
};
