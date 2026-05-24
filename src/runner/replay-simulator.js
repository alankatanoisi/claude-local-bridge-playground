'use strict';

/**
 * Replay simulator — read-only verification of ledger consistency.
 */

const { SessionLedger } = require('./session-ledger');

/**
 * Replay ledger into messages metadata without calling model or tools.
 * @param {string} sessionPath
 * @returns {{ ok: boolean, events: object[], issues: object[], messagesEstimate: number }}
 */
function replayFromLedger(sessionPath) {
  const ledger = new SessionLedger(sessionPath);
  const events = ledger.readAll();
  const issues = [];

  const gaps = ledger.detectGaps();
  for (const g of gaps) {
    issues.push({ kind: 'sequence_gap', ...g });
  }

  const pending = ledger.getPendingIntents();
  for (const p of pending) {
    issues.push({ kind: 'pending_effect', ...p });
  }

  let openToolUses = [];
  for (const ev of events) {
    if (ev.type === 'assistant_message' && ev.toolUseIds) {
      openToolUses.push(...ev.toolUseIds);
    }
    if (ev.type === 'tool_result_message' && ev.toolUseId) {
      openToolUses = openToolUses.filter((id) => id !== ev.toolUseId);
    }
  }
  for (const id of openToolUses) {
    issues.push({ kind: 'orphaned_tool_use', toolUseId: id });
  }

  const userPrompts = events.filter((e) => e.type === 'user_prompt').length;
  const assistantTurns = events.filter((e) => e.type === 'assistant_message').length;

  return {
    ok: issues.length === 0,
    events,
    issues,
    messagesEstimate: userPrompts + assistantTurns,
  };
}

module.exports = {
  replayFromLedger,
};
