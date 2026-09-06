'use strict';

/**
 * _history-index.js — shared helper for the `history` capability group
 * (search_history + expand_history). Not a tool itself (underscore prefix,
 * like _file-cache.js).
 *
 * Research review 2026-08-31, ideas 5+6 (Scroll, "Context as an Environment"):
 * the runner already keeps LOSSLESS canonical history in memory — the
 * projection layer only rewrites a per-request copy (context-projection.js
 * header contract). So "searchable history" needs no second store: these
 * helpers build a flat, addressable view over the canonical messages array
 * that run.js exposes to tools via ctx.getCanonicalMessages().
 *
 * Deliberately NOT SQLite/FTS5: Scroll's own ablation shows plain query tools
 * capture most of the losslessness benefit, canonical history is capped at
 * 32 MB (CANONICAL_HIGH_WATER_BYTES), and this repo avoids new dependencies.
 * If sessions outgrow a linear scan, an FTS mirror is the upgrade path.
 *
 * Address scheme (stable for the whole run, including resumed prefixes,
 * because canonical history is append-only):
 *   - "m<i>"       — message at canonical index i (all its text)
 *   - "m<i>.b<j>"  — block j inside message i
 *   - a tool_use id (e.g. "toolu_abc…") — the tool_result content for that
 *     call (falling back to the tool_use input if no result exists yet)
 *
 * Thinking blocks are excluded on purpose: signed thinking must stay
 * byte-identical in the message stream and is not evidence the model should
 * re-quote from history.
 */

const { stringifyToolResultContent } = require('../tool-result-content');

/** @typedef {{ address: string, messageIndex: number, blockIndex: number|null,
 *              role: string, kind: string, toolName: string|null,
 *              toolUseId: string|null, text: string }} HistoryEntry */

/**
 * Flatten canonical messages into addressable entries. `toolNamesById` is
 * built in the same pass so tool_result entries (whose blocks carry only the
 * tool_use_id) can be labeled with the tool that produced them.
 */
function buildHistoryIndex(messages) {
  const entries = [];
  const toolNamesById = new Map();

  for (let i = 0; i < (messages || []).length; i++) {
    const message = messages[i];
    if (!message) continue;
    const role = message.role || 'unknown';

    if (typeof message.content === 'string') {
      entries.push({
        address: 'm' + i,
        messageIndex: i,
        blockIndex: null,
        role,
        kind: role + '_text',
        toolName: null,
        toolUseId: null,
        text: message.content,
      });
      continue;
    }

    const blocks = Array.isArray(message.content) ? message.content : [];
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[j];
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;

      if (block.type === 'text' && typeof block.text === 'string') {
        entries.push({
          address: 'm' + i + '.b' + j,
          messageIndex: i,
          blockIndex: j,
          role,
          kind: role + '_text',
          toolName: null,
          toolUseId: null,
          text: block.text,
        });
      } else if (block.type === 'tool_use') {
        if (block.id) toolNamesById.set(block.id, block.name || 'unknown');
        entries.push({
          address: block.id || 'm' + i + '.b' + j,
          messageIndex: i,
          blockIndex: j,
          role,
          kind: 'tool_use',
          toolName: block.name || 'unknown',
          toolUseId: block.id || null,
          text: JSON.stringify(block.input || {}),
        });
      } else if (block.type === 'tool_result') {
        entries.push({
          address: block.tool_use_id || 'm' + i + '.b' + j,
          messageIndex: i,
          blockIndex: j,
          role,
          kind: 'tool_result',
          toolName: null, // resolved below once every tool_use has been seen
          toolUseId: block.tool_use_id || null,
          text: stringifyToolResultContent(block.content),
        });
      }
    }
  }

  // Second pass: label tool_results with the calling tool's name.
  for (const entry of entries) {
    if (entry.kind === 'tool_result' && entry.toolUseId) {
      entry.toolName = toolNamesById.get(entry.toolUseId) || 'unknown';
    }
  }

  return entries;
}

/**
 * Resolve an address (see scheme above) to the entry list it names.
 * A tool_use id prefers the tool_result (the recoverable evidence) over the
 * tool_use input. Returns [] when nothing matches.
 */
function resolveAddress(entries, rawAddress) {
  const address = String(rawAddress || '').trim();
  if (!address) return [];

  const messageMatch = /^m(\d+)(?:\.b(\d+))?$/.exec(address);
  if (messageMatch) {
    const messageIndex = Number(messageMatch[1]);
    const blockIndex = messageMatch[2] === undefined ? null : Number(messageMatch[2]);
    return entries.filter(
      (entry) => entry.messageIndex === messageIndex && (blockIndex === null || entry.blockIndex === blockIndex),
    );
  }

  const results = entries.filter((entry) => entry.kind === 'tool_result' && entry.toolUseId === address);
  if (results.length) return results;
  return entries.filter((entry) => entry.toolUseId === address);
}

/** Terms for deterministic scoring: lowercase, length ≥ 2, max 12 terms. */
function queryTerms(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while (count < 50) {
    position = haystack.indexOf(needle, position);
    if (position === -1) break;
    count++;
    position += needle.length;
  }
  return count;
}

/**
 * Deterministic relevance score: per-term occurrence counts (capped so one
 * spammy term cannot drown the rest) plus a whole-phrase bonus. No model
 * calls, no embeddings — same query, same history, same ranking, always.
 */
function scoreEntry(entry, terms, phrase) {
  const lower = entry.text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    score += Math.min(countOccurrences(lower, term), 5);
  }
  if (phrase && terms.length > 1 && lower.includes(phrase)) score += 5;
  return score;
}

/** A short window of text centered on the first match, for search hits. */
function snippetAround(text, terms, phrase, width) {
  const lower = text.toLowerCase();
  let at = phrase ? lower.indexOf(phrase) : -1;
  if (at === -1) {
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1 && (at === -1 || idx < at)) at = idx;
    }
  }
  if (at === -1) at = 0;
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  const clean = (fragment) => fragment.replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + clean(text.slice(start, end)) + (end < text.length ? '…' : '');
}

module.exports = { buildHistoryIndex, resolveAddress, queryTerms, scoreEntry, snippetAround };
