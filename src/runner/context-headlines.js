'use strict';

/**
 * context-headlines.js — the "what you've forgotten" index (research review
 * 2026-08-31, idea 7 / Scroll).
 *
 * search_history recovers only what the model thinks to ask about. When the
 * projection hides whole exchanges — digested behind a checkpoint, or with
 * their tool results stubbed/stale-dropped — the model no longer knows those
 * turns exist, so it cannot ask. This module keeps one compact HEADLINE per
 * hidden exchange and renders them as a rolled-up index the projection
 * appends near the current turn.
 *
 * Headlines are MODEL-WRITTEN without any extra model call: the assistant's
 * own first text line in a turn ("Let me list the directory.") is harvested
 * as that turn's headline. When a turn has no text (tool-only), a
 * host-derived summary of its tool calls stands in. Every line is bound to
 * canonical addresses (m<i>–m<j>, tool_use ids) so expand_history can recover
 * the span verbatim when the history group is offered.
 *
 * Deterministic and side-effect free: same canonical history → same index.
 * Like every projection artifact it is request-local and never written back
 * to canonical history (context-projection.js header contract).
 */

const { groupSemanticExchanges } = require('./message-contract');
const { stringifyToolResultContent } = require('./tool-result-content');

const HEADLINE_CHARS = 120;
const MAX_INDEX_LINES = 40;
const MAX_INDEX_CHARS = 6_000;

function oneLine(text, maxChars) {
  const flat = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= maxChars) return flat;
  return flat.slice(0, maxChars - 1) + '…';
}

function humanChars(count) {
  if (count < 1000) return count + ' chars';
  return (count / 1000).toFixed(count < 10_000 ? 1 : 0) + 'k chars';
}

/**
 * One headline per semantic exchange (user prompt + assistant turn + its tool
 * results). `seq` is the exchange's first canonical message index — the
 * stable address the whole index keys on.
 */
function buildHeadlines(messages) {
  const groups = groupSemanticExchanges(messages || []);
  const headlines = [];

  for (const group of groups) {
    let assistantText = null;
    let userText = null;
    const tools = [];
    const resultsById = new Map();

    for (const message of group.messages) {
      const blocks =
        typeof message?.content === 'string'
          ? [{ type: 'text', text: message.content }]
          : Array.isArray(message?.content)
            ? message.content
            : [];
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          if (message.role === 'assistant' && assistantText === null) assistantText = block.text;
          if (message.role === 'user' && userText === null) userText = block.text;
        } else if (block.type === 'tool_use') {
          tools.push({
            id: block.id || null,
            name: block.name || 'unknown',
            path: block.input && typeof block.input.path === 'string' ? block.input.path : null,
          });
        } else if (block.type === 'tool_result') {
          resultsById.set(block.tool_use_id, {
            ok: !block.is_error,
            chars: stringifyToolResultContent(block.content).length,
          });
        }
      }
    }

    for (const tool of tools) {
      const result = tool.id ? resultsById.get(tool.id) : null;
      tool.ok = result ? result.ok : null;
      tool.chars = result ? result.chars : null;
    }

    const toolSummary = tools
      .map((tool) => {
        let piece = tool.name + (tool.path ? ' ' + tool.path : '');
        if (tool.chars !== null) piece += ' → ' + humanChars(tool.chars) + (tool.ok ? '' : ' ERROR');
        return piece;
      })
      .join('; ');

    // Model-written headline first; host-derived tool summary as the fallback
    // for tool-only turns; a bare user turn falls back to the user's words.
    let headline;
    let source;
    if (assistantText) {
      headline = oneLine(assistantText, HEADLINE_CHARS);
      source = 'assistant';
    } else if (toolSummary) {
      headline = oneLine(toolSummary, HEADLINE_CHARS);
      source = 'tools';
    } else if (userText) {
      headline = 'user: ' + oneLine(userText, HEADLINE_CHARS - 6);
      source = 'user';
    } else {
      headline = '(no text)';
      source = 'none';
    }

    headlines.push({
      seq: group.start,
      start: group.start,
      end: group.end, // exclusive, like groupSemanticExchanges
      headline,
      source,
      toolSummary,
      toolUseIds: tools.map((tool) => tool.id).filter(Boolean),
    });
  }

  return headlines;
}

/**
 * Which headlines describe exchanges the model can no longer see verbatim?
 *   - every exchange that ends at or before the checkpoint rawCutoff (digested)
 *   - every exchange containing a tool_result that was stubbed or stale-dropped
 * Clipped (head+tail) results still show real bytes plus their own recovery
 * marker, so they are NOT counted as hidden — the index stays about absence.
 */
function selectHiddenHeadlines(headlines, { rawCutoff = 0, hiddenToolUseIds = new Set() } = {}) {
  return headlines.filter((entry) => {
    if (rawCutoff > 0 && entry.end <= rawCutoff) return true;
    return entry.toolUseIds.some((id) => hiddenToolUseIds.has(id));
  });
}

function rangeLabel(entry) {
  return entry.end - entry.start <= 1 ? 'm' + entry.start : 'm' + entry.start + '–m' + (entry.end - 1);
}

/**
 * Render the rolled-up index. Recent hidden exchanges get one line each; when
 * more than `maxLines` are hidden, the OLDEST collapse into a single range
 * line with per-tool counts (Scroll's tiered roll-up) — the model still learns
 * that those turns exist and where they start.
 */
function renderHeadlineIndex(hidden, { recoveryEnabled = false, maxLines = MAX_INDEX_LINES } = {}) {
  if (!hidden || hidden.length === 0) return { text: '', entries: 0, rolledUp: 0 };

  const lines = [];
  const rolledUp = Math.max(0, hidden.length - maxLines);
  const collapsed = hidden.slice(0, rolledUp);
  const shown = hidden.slice(rolledUp);

  lines.push(
    '[context:headline-index v1] ' +
      hidden.length +
      ' earlier exchange(s) are no longer shown verbatim in this request.' +
      (recoveryEnabled
        ? ' Recover any of them with expand_history (id = a tool_use id below, or "m<index>"); locate details with search_history.'
        : ' Their bytes remain in canonical history; re-run a tool if you need exact content.'),
  );

  if (collapsed.length) {
    const toolCounts = new Map();
    for (const entry of collapsed) {
      for (const piece of entry.toolSummary ? entry.toolSummary.split('; ') : []) {
        const name = piece.split(' ')[0];
        toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
    }
    const counts = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => name + '×' + count)
      .join(', ');
    lines.push(
      '- m' +
        collapsed[0].start +
        '–m' +
        (collapsed[collapsed.length - 1].end - 1) +
        ' | ' +
        collapsed.length +
        ' older exchange(s), rolled up' +
        (counts ? ' | tools: ' + counts : ''),
    );
  }

  for (const entry of shown) {
    let line = '- ' + rangeLabel(entry) + ' | ' + entry.headline;
    if (entry.source === 'assistant' && entry.toolSummary) line += ' | ' + oneLine(entry.toolSummary, 100);
    if (entry.toolUseIds.length) line += ' | ids: ' + entry.toolUseIds.slice(0, 4).join(', ');
    lines.push(line);
  }

  let text = lines.join('\n');
  if (text.length > MAX_INDEX_CHARS) {
    text = text.slice(0, MAX_INDEX_CHARS - 40) + '\n… [headline index bounded at ' + MAX_INDEX_CHARS + ' chars]';
  }
  return { text, entries: hidden.length, rolledUp };
}

module.exports = {
  HEADLINE_CHARS,
  MAX_INDEX_LINES,
  MAX_INDEX_CHARS,
  buildHeadlines,
  selectHiddenHeadlines,
  renderHeadlineIndex,
};
