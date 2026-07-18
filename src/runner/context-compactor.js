'use strict';

/**
 * Context compaction ladder — select / snip / summarize / ghost markers.
 *
 * Cheapest-first loss functions before paying for full summarization.
 * Ghost blocks tell the model what was intentionally compressed.
 */

const { CATEGORIES, WRITE_TOOLS } = require('./tool-catalog');
const { stringifyToolResultContent } = require('./tool-result-content');
const { groupSemanticExchanges } = require('./message-contract');

const COMPACTION_STAGES = Object.freeze(['none', 'clip', 'snip', 'cost', 'ghost', 'summarize']);

const DEFAULT_POLICY = Object.freeze({
  /** Approximate token budget before first action (heuristic: chars / 4). */
  warnTokens: 80_000,
  haltTokens: 160_000,
  /** Max chars per tool_result content before clip stage. */
  maxToolResultChars: 12_000,
  /** After this many messages, snip oldest tool_result bodies. */
  snipAfterMessages: 24,
  /** After this many messages, inject ghost summary block. */
  ghostAfterMessages: 40,
  /** Preserve last N user/assistant turns verbatim. */
  preserveRecentTurns: 6,
  /**
   * Message-count compaction is intentionally opt-in. A long task can have many
   * small turns while still being far below the token budget; snipping those
   * turns too early makes the model re-read files it already inspected.
   */
  snipOnMessageCount: false,
  ghostOnMessageCount: false,
});

const _blockCharCache = new WeakMap();

function estimateBlockChars(block) {
  const cached = _blockCharCache.get(block);
  if (cached !== undefined) return cached;
  let n = 0;
  if (block.text) n += block.text.length;
  if (block.content) n += String(block.content).length;
  if (block.input) n += JSON.stringify(block.input).length;
  _blockCharCache.set(block, n);
  return n;
}

function estimateTokens(messages) {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        chars += estimateBlockChars(block);
      }
    }
  }
  return Math.ceil(chars / 4);
}

function clipToolResults(messages, maxChars) {
  let changed = false;
  const out = messages.map((msg) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const content = msg.content.map((block) => {
      if (block.type !== 'tool_result') return block;
      const text = stringifyToolResultContent(block.content);
      if (text.length <= maxChars) return block;
      changed = true;
      const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
      if (limit === 0) return { ...block, content: '' };

      // The notice is part of the limit. Calculate the retained prefix against
      // the final notice length so the first pass is bounded and every later
      // pass is a true no-op.
      let keepChars = limit;
      let notice = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        const omitted = Math.max(0, text.length - keepChars);
        notice = '\n... [compaction:clip omitted ' + omitted + ' chars; re-fetch with read_file if needed]';
        keepChars = Math.max(0, limit - notice.length);
      }
      const clipped = notice.length >= limit ? '[compaction:clip]'.slice(0, limit) : text.slice(0, keepChars) + notice;
      return { ...block, content: clipped.slice(0, limit) };
    });
    return { ...msg, content };
  });
  return { messages: out, stage: changed ? 'clip' : 'none', changed };
}

function preservedTailCutoff(messages, preserveRecent) {
  const groups = groupSemanticExchanges(messages);
  const keep = Math.max(0, Math.floor(Number(preserveRecent) || 0));
  if (keep === 0) return messages.length;
  if (groups.length <= keep) return 0;
  return groups[groups.length - keep].start;
}

function snipOldToolResults(messages, snipAfter, preserveRecent) {
  if (messages.length <= snipAfter) return { messages, stage: 'none', changed: false };

  const cutoff = preservedTailCutoff(messages, preserveRecent);
  let changed = false;
  const out = messages.map((msg, idx) => {
    if (idx >= cutoff || msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const content = msg.content.map((block) => {
      if (block.type !== 'tool_result') return block;
      const text = stringifyToolResultContent(block.content);
      if (text.length < 200) return block;
      changed = true;
      return {
        ...block,
        content: '[compaction:snip] tool output removed (' + text.length + ' chars). Re-run tool if needed.',
      };
    });
    return { ...msg, content };
  });
  return { messages: out, stage: changed ? 'snip' : 'none', changed };
}

/**
 * Ext-12: cost-aware drop stage. Replaces tool_result content for read-only
 * tool calls whose target path was subsequently written by a later tool_use
 * in the same conversation. Such reads are stale by construction — the file
 * on disk no longer matches what the model is looking at — so keeping their
 * content wastes tokens without providing usable information.
 *
 * Only fires on tool_results outside the preserved-recent window. The model
 * sees a stale marker telling it to re-read if needed.
 */
// Derived from each tool's declared category (see tool-catalog.js) instead of
// re-listing tool names that must be kept in sync by hand.
const _READ_TOOLS = new Set(Object.keys(CATEGORIES).filter((name) => CATEGORIES[name] === 'read-only'));
const _WRITE_TOOLS = WRITE_TOOLS;

function _walkToolEvents(messages, fn) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        fn({ kind: 'use', msgIdx: i, id: block.id, name: block.name, path: block.input && block.input.path });
      } else if (block.type === 'tool_result' && block.tool_use_id) {
        fn({ kind: 'result', msgIdx: i, id: block.tool_use_id, content: block.content });
      }
    }
  }
}

function dropStaleToolResults(messages, preserveRecent) {
  const idToUse = new Map(); // tool_use_id -> { msgIdx, name, path }
  _walkToolEvents(messages, (ev) => {
    if (ev.kind === 'use') idToUse.set(ev.id, { msgIdx: ev.msgIdx, name: ev.name, path: ev.path });
  });

  const writesByPath = new Map(); // path -> [msgIdx]
  for (const use of idToUse.values()) {
    if (_WRITE_TOOLS.has(use.name) && use.path) {
      if (!writesByPath.has(use.path)) writesByPath.set(use.path, []);
      writesByPath.get(use.path).push(use.msgIdx);
    }
  }

  const cutoff = preservedTailCutoff(messages, preserveRecent);
  let changed = false;
  const staleIds = new Set();
  for (const [id, use] of idToUse) {
    if (use.msgIdx >= cutoff) continue;
    if (!_READ_TOOLS.has(use.name)) continue;
    if (!use.path) continue;
    const writes = writesByPath.get(use.path);
    if (!writes) continue;
    if (writes.some((widx) => widx > use.msgIdx)) staleIds.add(id);
  }
  if (staleIds.size === 0) return { messages, stage: 'none', changed: false, dropped: 0 };

  const out = messages.map((msg) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const content = msg.content.map((block) => {
      if (block.type !== 'tool_result' || !block.tool_use_id) return block;
      if (!staleIds.has(block.tool_use_id)) return block;
      const orig = String(block.content || '');
      changed = true;
      return {
        ...block,
        content:
          '[compaction:cost-aware] Stale tool_result (' +
          orig.length +
          ' chars) — a later turn wrote to the same path. Re-read if you need current contents.',
      };
    });
    return { ...msg, content };
  });
  return { messages: out, stage: changed ? 'cost' : 'none', changed, dropped: staleIds.size };
}

function buildGhostBlock(messages, generation) {
  const toolIds = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.id) toolIds.push(block.id);
    }
  }
  const unique = [...new Set(toolIds)].slice(-20);
  return {
    type: 'text',
    text:
      '[compaction:ghost gen=' +
      generation +
      '] Older turns were compressed. Preserved tool_use ids (sample): ' +
      (unique.length ? unique.join(', ') : 'none') +
      '. Treat prior summaries as snapshots; re-fetch only the specific current bytes needed before mutating files.',
  };
}

function injectGhostSystemBlock(system, ghostBlock) {
  if (typeof system === 'string') {
    return [{ type: 'text', text: system }, ghostBlock];
  }
  if (Array.isArray(system)) {
    return [...system, ghostBlock];
  }
  return [ghostBlock];
}

function summarizeOldTurns(messages, preserveRecent) {
  const cutoff = preservedTailCutoff(messages, preserveRecent);
  if (cutoff <= 0) return { messages, stage: 'none', changed: false };

  const head = messages.slice(0, cutoff);
  const tail = messages.slice(cutoff);
  const summaryParts = [];
  for (const msg of head) {
    if (typeof msg.content === 'string') {
      summaryParts.push(msg.role + ': ' + msg.content.slice(0, 120));
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) summaryParts.push(msg.role + ': ' + block.text.slice(0, 80));
        if (block.type === 'tool_use') summaryParts.push('tool_use:' + block.name);
        if (block.type === 'tool_result') summaryParts.push('tool_result:' + String(block.content || '').slice(0, 60));
      }
    }
  }
  const summaryText =
    '[compaction:summarize] Earlier conversation summary (' +
    head.length +
    ' messages):\n' +
    summaryParts.slice(0, 30).join('\n');

  const summaryMsg = { role: 'user', content: summaryText };
  return { messages: [summaryMsg, ...tail], stage: 'summarize', changed: true };
}

/**
 * Apply compaction ladder to messages; returns updated messages + metadata.
 */
function applyCompactionLadder(messages, system, policy = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const tokens = estimateTokens(messages);
  const result = {
    messages,
    system,
    tokensEstimated: tokens,
    stagesApplied: [],
    changed: false,
    generation: policy.compactionGeneration || 0,
  };

  if (tokens < p.warnTokens && messages.length < p.snipAfterMessages) {
    return result;
  }

  let current = messages;
  let sys = system;
  const overWarnTokens = tokens >= p.warnTokens;
  const overHaltTokens = tokens >= p.haltTokens;
  const overSnipMessageCount = messages.length > p.snipAfterMessages;
  const overGhostMessageCount = messages.length >= p.ghostAfterMessages;

  const clip = clipToolResults(current, p.maxToolResultChars);
  if (clip.changed) {
    current = clip.messages;
    result.stagesApplied.push('clip');
    result.changed = true;
  }

  const shouldSnip = overWarnTokens || (p.snipOnMessageCount && overSnipMessageCount);
  if (shouldSnip) {
    const snip = snipOldToolResults(current, p.snipAfterMessages, p.preserveRecentTurns);
    if (snip.changed) {
      current = snip.messages;
      result.stagesApplied.push('snip');
      result.changed = true;
    }
  }

  // Ext-12: cost-aware drop runs after the cheap stages. Targets stale
  // tool_results superseded by later writes — cheapest possible bytes to drop
  // because the model can't usefully reference their content anyway.
  if (shouldSnip) {
    const cost = dropStaleToolResults(current, p.preserveRecentTurns);
    if (cost.changed) {
      current = cost.messages;
      result.stagesApplied.push('cost');
      result.costDropped = cost.dropped;
      result.changed = true;
    }
  }

  const lossyStageApplied = result.stagesApplied.some((stage) => stage === 'snip' || stage === 'cost');
  const shouldGhost = overWarnTokens || lossyStageApplied || (p.ghostOnMessageCount && overGhostMessageCount);
  if (shouldGhost) {
    const ghost = buildGhostBlock(current, result.generation + 1);
    sys = injectGhostSystemBlock(sys, ghost);
    result.stagesApplied.push('ghost');
    result.changed = true;
    result.generation += 1;
  }

  if (overHaltTokens || (overWarnTokens && messages.length >= p.ghostAfterMessages + 4)) {
    const sum = summarizeOldTurns(current, p.preserveRecentTurns);
    if (sum.changed) {
      current = sum.messages;
      result.stagesApplied.push('summarize');
      result.changed = true;
      result.generation += 1;
    } else {
      result.stagesApplied.push('summarize_pending');
      result.needsFullSummarize = true;
    }
  }

  result.messages = current;
  result.system = sys;
  return result;
}

module.exports = {
  COMPACTION_STAGES,
  DEFAULT_POLICY,
  estimateTokens,
  clipToolResults,
  snipOldToolResults,
  dropStaleToolResults,
  buildGhostBlock,
  injectGhostSystemBlock,
  summarizeOldTurns,
  applyCompactionLadder,
};
