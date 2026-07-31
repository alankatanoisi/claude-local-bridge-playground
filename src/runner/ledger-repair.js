'use strict';

/**
 * Ledger repair + ledger-aware resume reconciliation (F6).
 *
 * planRepair describes mutations; applyRepair performs them when approved.
 * reconcileForResume is what --resume-session calls: it auto-approves the
 * safe subset so a crash-scarred checkpoint becomes contract-valid and does
 * not silently re-execute side effects the ledger already recorded.
 *
 * Two measured failure shapes from A1 (docs/durability-crash-bakeoff-2026-07-31.md):
 *   1. Stale checkpoint — ledger has completed effects the debounced
 *      checkpoint never flushed → inject recovered exchanges.
 *   2. Dangling tool_use — checkpoint ends mid-tool → inject synthetic
 *      tool_result (+ mark any matching pending ledger intents aborted).
 */

const fs = require('fs');
const { replayFromLedger } = require('./replay-simulator');
const { SessionLedger } = require('./session-ledger');
const { SessionStore } = require('./session-store');
const { toolUseIds, toolResultIds, assertValidAnthropicMessages } = require('./message-contract');

const SYNTHETIC_ABORT_TEXT =
  'Recovered after crash: this tool did not finish before the process died. ' +
  'Treat the side effect as aborted; re-try only if still needed.';

const SYNTHETIC_RECOVERED_TEXT =
  'Recovered from ledger: this tool already completed before the process died. ' +
  'Do not repeat this side effect.';

/**
 * Scan checkpoint messages for tool_use / tool_result coverage and any
 * dangling trailing tool_use batch (the A1-F3 message-contract strand).
 */
function inspectCheckpointMessages(messages) {
  const resultIds = new Set();
  const useIds = new Set();
  const danglingUses = [];

  if (!Array.isArray(messages)) {
    return { resultIds, useIds, danglingUses };
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    for (const id of toolResultIds(msg)) resultIds.add(id);
    const uses = toolUseIds(msg);
    for (const id of uses) useIds.add(id);

    if (uses.length === 0) continue;
    const next = messages[i + 1];
    const nextResults = next ? toolResultIds(next) : [];
    const nextSet = new Set(nextResults);
    const missing = uses.filter((id) => !nextSet.has(id));
    // Only the final incomplete batch is actionable for resume — earlier
    // mismatches are deeper corruption that report_gap-style review needs.
    if (missing.length > 0 && i === messages.length - 1) {
      for (const block of msg.content || []) {
        if (block?.type !== 'tool_use') continue;
        const id = typeof block.id === 'string' ? block.id.trim() : '';
        if (missing.includes(id)) {
          danglingUses.push({
            toolUseId: id,
            name: typeof block.name === 'string' ? block.name : 'unknown_tool',
            messageIndex: i,
          });
        }
      }
    }
  }

  return { resultIds, useIds, danglingUses };
}

/**
 * Walk ledger events into completed vs pending effect rows (by toolUseId).
 */
function collectLedgerEffects(events) {
  const byToolUse = new Map();
  for (const ev of events || []) {
    if (!ev || !ev.toolUseId) continue;
    if (ev.type === 'tool_effect_intent') {
      const row = byToolUse.get(ev.toolUseId) || { toolUseId: ev.toolUseId };
      row.effectId = ev.effectId || row.effectId;
      row.tool = ev.tool || row.tool;
      row.intentSeq = ev.seq;
      byToolUse.set(ev.toolUseId, row);
    }
    if (ev.type === 'tool_effect_result') {
      const row = byToolUse.get(ev.toolUseId) || { toolUseId: ev.toolUseId };
      row.effectId = ev.effectId || row.effectId;
      row.tool = ev.tool || row.tool;
      row.resultSeq = ev.seq;
      row.ok = ev.ok !== false;
      row.aborted = !!ev.aborted;
      byToolUse.set(ev.toolUseId, row);
    }
  }

  const completed = [];
  const pending = [];
  for (const row of byToolUse.values()) {
    const hasResult = typeof row.resultSeq === 'number';
    const hasIntent = typeof row.intentSeq === 'number';
    if (hasResult && !row.aborted) completed.push(row);
    else if (hasIntent && !hasResult) pending.push(row);
  }
  completed.sort((a, b) => (a.resultSeq || 0) - (b.resultSeq || 0));
  pending.sort((a, b) => (a.intentSeq || 0) - (b.intentSeq || 0));
  return { completed, pending };
}

function loadCheckpointMessages(sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    return Array.isArray(raw.messages) ? raw.messages : [];
  } catch {
    return [];
  }
}

/**
 * Describe repair actions for detected issues (does not mutate without approval).
 * @param {string} sessionPath
 * @param {object[]|null} [messages] checkpoint messages; loaded from disk when omitted
 * @returns {{ issues: object[], repairPlan: object[] }}
 */
function planRepair(sessionPath, messages = null) {
  const replay = replayFromLedger(sessionPath);
  const checkpointMessages = Array.isArray(messages) ? messages : loadCheckpointMessages(sessionPath);
  const checkpoint = inspectCheckpointMessages(checkpointMessages);
  const ledgerEffects = collectLedgerEffects(replay.events);
  const repairPlan = [];
  const issues = [...replay.issues];

  // Shape 2 / A1-F3: dangling tool_use in the checkpoint (detected from
  // messages, not from the dead assistant_message ledger vocabulary — A1-F4).
  for (const dangling of checkpoint.danglingUses) {
    issues.push({
      kind: 'dangling_tool_use',
      toolUseId: dangling.toolUseId,
      tool: dangling.name,
      messageIndex: dangling.messageIndex,
    });
    repairPlan.push({
      action: 'inject_synthetic_tool_result',
      toolUseId: dangling.toolUseId,
      tool: dangling.name,
      description: 'Inject placeholder tool_result for dangling checkpoint tool_use',
    });
  }

  // Pending ledger intents: mark aborted. If the matching tool_use is also
  // dangling in the checkpoint, the inject above already covers the messages.
  for (const issue of replay.issues) {
    if (issue.kind === 'pending_effect') {
      const pendingRow = ledgerEffects.pending.find((p) => p.effectId === issue.id) || {
        effectId: issue.id,
        toolUseId: issue.toolUseId || null,
        tool: issue.tool || null,
      };
      repairPlan.push({
        action: 'mark_pending_aborted',
        effectId: pendingRow.effectId || issue.id,
        toolUseId: pendingRow.toolUseId || null,
        tool: pendingRow.tool || null,
        description: 'Mark incomplete effect as aborted after crash',
      });
    }
    if (issue.kind === 'orphaned_tool_use') {
      // Legacy branch (A1-F4): still propose inject if checkpoint analysis
      // did not already cover this id.
      if (!checkpoint.danglingUses.some((d) => d.toolUseId === issue.toolUseId)) {
        repairPlan.push({
          action: 'inject_synthetic_tool_result',
          toolUseId: issue.toolUseId,
          description: 'Inject placeholder tool_result for orphaned tool_use',
        });
      }
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

  // Shape 1 / A1-F2: completed ledger effects missing from the checkpoint.
  for (const row of ledgerEffects.completed) {
    if (!row.toolUseId || checkpoint.resultIds.has(row.toolUseId)) continue;
    issues.push({
      kind: 'missing_completed_effect',
      effectId: row.effectId,
      toolUseId: row.toolUseId,
      tool: row.tool,
    });
    repairPlan.push({
      action: 'inject_recovered_exchange',
      effectId: row.effectId,
      toolUseId: row.toolUseId,
      tool: row.tool || 'unknown_tool',
      ok: row.ok !== false,
      description: 'Reconstruct completed tool exchange missing from stale checkpoint',
    });
  }

  return { issues, repairPlan };
}

function syntheticToolResult(toolUseId, text, isError) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: text,
    is_error: !!isError,
  };
}

function syntheticRecoveredAssistant(toolUseId, tool, effectId) {
  return {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: tool || 'unknown_tool',
        input: {
          _recovered_from_ledger: true,
          effectId: effectId || null,
          note: 'Original tool arguments were not retained in the ledger.',
        },
      },
    ],
  };
}

/**
 * Apply repair plan (caller must have obtained approval, or use reconcileForResume).
 * Mutates the session checkpoint and may append ledger events.
 *
 * @param {string} sessionPath
 * @param {object[]} repairPlan
 * @param {boolean} [approved=false]
 * @param {{ messages?: object[] }} [options]
 * @returns {object}
 */
function applyRepair(sessionPath, repairPlan, approved = false, options = {}) {
  const plan = Array.isArray(repairPlan) ? repairPlan : [];
  if (!approved) {
    return { applied: false, reason: 'repair_requires_approval', repairPlan: plan };
  }
  if (!sessionPath) {
    return { applied: false, reason: 'missing_session_path', repairPlan: plan };
  }

  const store = new SessionStore(sessionPath);
  store.load();
  let messages = Array.isArray(options.messages) ? options.messages.slice() : store.messages.slice();
  const ledger = new SessionLedger(sessionPath);

  const appliedActions = [];
  const skipped = [];

  // Group synthetic tool_results that belong to the same dangling trailing
  // assistant message so we inject one contract-valid user batch.
  const syntheticByMessage = new Map();
  const recoveredExchanges = [];
  const abortMarks = [];

  for (const action of plan) {
    if (!action || !action.action) continue;
    if (action.action === 'report_gap') {
      skipped.push({ ...action, reason: 'manual_review_only' });
      continue;
    }
    if (action.action === 'mark_pending_aborted') {
      abortMarks.push(action);
      continue;
    }
    if (action.action === 'inject_synthetic_tool_result') {
      const checkpoint = inspectCheckpointMessages(messages);
      const dangling = checkpoint.danglingUses.find((d) => d.toolUseId === action.toolUseId);
      if (!dangling) {
        // No dangling batch — still allow a trailing inject if the id is known
        // from the plan but not currently dangling (idempotent no-op when the
        // result already exists).
        if (checkpoint.resultIds.has(action.toolUseId)) {
          skipped.push({ ...action, reason: 'already_has_tool_result' });
          continue;
        }
        skipped.push({ ...action, reason: 'no_dangling_tool_use' });
        continue;
      }
      const key = dangling.messageIndex;
      if (!syntheticByMessage.has(key)) syntheticByMessage.set(key, []);
      syntheticByMessage.get(key).push(action);
      continue;
    }
    if (action.action === 'inject_recovered_exchange') {
      recoveredExchanges.push(action);
      continue;
    }
    skipped.push({ ...action, reason: 'unknown_action' });
  }

  // 1. Mark pending ledger intents aborted (append-only; never rewrite history).
  for (const action of abortMarks) {
    const effectId = action.effectId;
    if (!effectId) {
      skipped.push({ ...action, reason: 'missing_effect_id' });
      continue;
    }
    const stillPending = ledger.getPendingIntents().some((p) => p.id === effectId);
    if (!stillPending) {
      skipped.push({ ...action, reason: 'not_pending' });
      continue;
    }
    ledger.append('tool_effect_result', {
      effectId,
      toolUseId: action.toolUseId || null,
      tool: action.tool || null,
      ok: false,
      aborted: true,
      reason: 'crash_recovery',
    });
    appliedActions.push({ ...action, status: 'aborted_in_ledger' });
  }

  // 2. Inject synthetic tool_result batches for dangling checkpoint tool_uses.
  // Process highest message index first so earlier splices don't shift later ones.
  const messageIndexes = [...syntheticByMessage.keys()].sort((a, b) => b - a);
  for (const messageIndex of messageIndexes) {
    const actions = syntheticByMessage.get(messageIndex);
    const assistant = messages[messageIndex];
    if (!assistant || assistant.role !== 'assistant') {
      for (const action of actions) skipped.push({ ...action, reason: 'assistant_missing' });
      continue;
    }
    const uses = toolUseIds(assistant);
    const next = messages[messageIndex + 1];
    if (next && next.role === 'user' && toolResultIds(next).length > 0) {
      for (const action of actions) skipped.push({ ...action, reason: 'batch_already_followed' });
      continue;
    }
    const blocks = uses.map((id) => {
      return syntheticToolResult(id, SYNTHETIC_ABORT_TEXT, true);
    });
    messages.splice(messageIndex + 1, 0, { role: 'user', content: blocks });
    for (const action of actions) {
      appliedActions.push({ ...action, status: 'injected_synthetic_tool_result' });
    }
  }

  // 3. Reconstruct completed exchanges missing from a stale checkpoint.
  // Append after existing messages (before the resume prompt the caller adds).
  for (const action of recoveredExchanges) {
    const checkpoint = inspectCheckpointMessages(messages);
    if (checkpoint.resultIds.has(action.toolUseId)) {
      skipped.push({ ...action, reason: 'already_has_tool_result' });
      continue;
    }
    // If this id is currently a dangling trailing tool_use, prefer the
    // synthetic-result path (already handled). Skip duplicate reconstruction.
    if (checkpoint.danglingUses.some((d) => d.toolUseId === action.toolUseId)) {
      skipped.push({ ...action, reason: 'handled_as_dangling' });
      continue;
    }
    messages.push(syntheticRecoveredAssistant(action.toolUseId, action.tool, action.effectId));
    messages.push({
      role: 'user',
      content: [
        syntheticToolResult(
          action.toolUseId,
          action.ok === false ? SYNTHETIC_ABORT_TEXT : SYNTHETIC_RECOVERED_TEXT,
          action.ok === false,
        ),
      ],
    });
    appliedActions.push({ ...action, status: 'injected_recovered_exchange' });
  }

  // Persist checkpoint synchronously — resume must see the repaired history.
  store.setMessages(messages);
  store.updateRunner({
    lastRepair: {
      at: new Date().toISOString(),
      applied: appliedActions.length,
      skipped: skipped.length,
      actions: appliedActions.map((a) => a.action),
    },
  });
  store.flushSync();

  if (appliedActions.length > 0) {
    ledger.append('repair_applied', {
      applied: appliedActions.length,
      skipped: skipped.length,
      actions: appliedActions.map((a) => ({ action: a.action, toolUseId: a.toolUseId || null })),
    });
  }
  ledger.close();

  // Best-effort contract check so callers can refuse a still-broken resume.
  let contractOk = true;
  let contractError = null;
  try {
    if (messages.length > 0) assertValidAnthropicMessages(messages);
  } catch (err) {
    contractOk = false;
    contractError = err.message;
  }

  return {
    applied: appliedActions.length > 0,
    actions: appliedActions.length,
    appliedActions,
    skipped,
    repairPlan: plan,
    messages,
    contractOk,
    contractError,
  };
}

/**
 * Resume-path helper: plan + auto-approve safe mutations, return messages to use.
 * report_gap actions are never auto-applied.
 *
 * @param {string} sessionPath
 * @param {object[]} messages
 * @returns {{ mutated: boolean, messages: object[], plan: object, result: object|null }}
 */
function reconcileForResume(sessionPath, messages) {
  const plan = planRepair(sessionPath, messages);
  const autoPlan = plan.repairPlan.filter((a) => a && a.action !== 'report_gap');
  if (autoPlan.length === 0) {
    return { mutated: false, messages, plan, result: null };
  }
  const result = applyRepair(sessionPath, autoPlan, true, { messages });
  return {
    mutated: !!result.applied,
    messages: Array.isArray(result.messages) ? result.messages : messages,
    plan,
    result,
  };
}

module.exports = {
  planRepair,
  applyRepair,
  reconcileForResume,
  inspectCheckpointMessages,
  collectLedgerEffects,
  SYNTHETIC_ABORT_TEXT,
  SYNTHETIC_RECOVERED_TEXT,
};
