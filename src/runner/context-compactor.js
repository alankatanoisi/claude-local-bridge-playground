'use strict';

/**
 * Context compaction ladder — select / snip / summarize / ghost markers.
 *
 * Cheapest-first loss functions before paying for full summarization.
 * Ghost blocks tell the model what was intentionally compressed.
 */

const COMPACTION_STAGES = Object.freeze(['none', 'clip', 'snip', 'ghost', 'summarize']);

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
      const text = String(block.content || '');
      if (text.length <= maxChars) return block;
      changed = true;
      return {
        ...block,
        content:
          text.slice(0, maxChars) +
          '\n... [compaction:clip truncated ' +
          (text.length - maxChars) +
          ' chars; re-fetch with read_file if needed]',
      };
    });
    return { ...msg, content };
  });
  return { messages: out, stage: changed ? 'clip' : 'none', changed };
}

function snipOldToolResults(messages, snipAfter, preserveRecent) {
  if (messages.length <= snipAfter) return { messages, stage: 'none', changed: false };

  const cutoff = Math.max(0, messages.length - preserveRecent * 2);
  let changed = false;
  const out = messages.map((msg, idx) => {
    if (idx >= cutoff || msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
    const content = msg.content.map((block) => {
      if (block.type !== 'tool_result') return block;
      const text = String(block.content || '');
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
      '. Treat prior summaries as snapshots; re-fetch live state before mutating files.',
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
  const cutoff = Math.max(0, messages.length - preserveRecent * 2);
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

  const clip = clipToolResults(current, p.maxToolResultChars);
  if (clip.changed) {
    current = clip.messages;
    result.stagesApplied.push('clip');
    result.changed = true;
  }

  const snip = snipOldToolResults(current, p.snipAfterMessages, p.preserveRecentTurns);
  if (snip.changed) {
    current = snip.messages;
    result.stagesApplied.push('snip');
    result.changed = true;
  }

  if (messages.length >= p.ghostAfterMessages || tokens >= p.warnTokens) {
    const ghost = buildGhostBlock(current, result.generation + 1);
    sys = injectGhostSystemBlock(sys, ghost);
    result.stagesApplied.push('ghost');
    result.changed = true;
    result.generation += 1;
  }

  if (tokens >= p.haltTokens || (tokens >= p.warnTokens && messages.length >= p.ghostAfterMessages + 4)) {
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
  buildGhostBlock,
  injectGhostSystemBlock,
  summarizeOldTurns,
  applyCompactionLadder,
};
