'use strict';

/**
 * Ledger repair — mutating fixes with explicit approval (separate from replay).
 */

const { replayFromLedger } = require('./replay-simulator');

/**
 * Describe repair actions for detected issues (does not mutate without approval).
 * @param {string} sessionPath
 * @returns {{ issues: object[], repairPlan: object[] }}
 */
function planRepair(sessionPath) {
  const replay = replayFromLedger(sessionPath);
  const repairPlan = [];

  for (const issue of replay.issues) {
    if (issue.kind === 'pending_effect') {
      repairPlan.push({
        action: 'mark_pending_aborted',
        effectId: issue.id,
        description: 'Mark incomplete effect as aborted after crash',
      });
    }
    if (issue.kind === 'orphaned_tool_use') {
      repairPlan.push({
        action: 'inject_synthetic_tool_result',
        toolUseId: issue.toolUseId,
        description: 'Inject placeholder tool_result for orphaned tool_use',
      });
    }
    if (issue.kind === 'sequence_gap') {
      repairPlan.push({
        action: 'report_gap',
        after: issue.after,
        found: issue.found,
        description: 'Sequence gap detected — manual review required',
      });
    }
  }

  return { issues: replay.issues, repairPlan };
}

/**
 * Apply repair plan (caller must have obtained approval).
 * v1: returns plan only; actual mutation deferred to checkpoint rebuild.
 */
function applyRepair(sessionPath, repairPlan, approved = false) {
  if (!approved) {
    return { applied: false, reason: 'repair_requires_approval', repairPlan };
  }
  return { applied: true, actions: repairPlan.length, repairPlan };
}

module.exports = {
  planRepair,
  applyRepair,
};
