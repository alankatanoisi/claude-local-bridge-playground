'use strict';

/**
 * search_history tool — deterministic full-text search over this session's
 * own canonical (lossless) history. Read-only; `history` capability group.
 *
 * Why it exists (research review 2026-08-31, idea 5 / Scroll): under context
 * pressure the projection clips or stubs old tool results out of the request,
 * but the canonical history stays lossless. Without a recall tool the model
 * can only re-run tools (paying again) or guess. This tool locates evidence;
 * expand_history recovers it verbatim.
 *
 * Output flows through the central redaction boundary in tool-registry's
 * runAndScrub like every other tool, so recovered snippets cannot leak
 * secrets that the boundary would have caught the first time.
 */

const { buildHistoryIndex, queryTerms, scoreEntry, snippetAround } = require('./_history-index');

const DEFAULT_MAX_RESULTS = 8;
const HARD_MAX_RESULTS = 25;
const SNIPPET_CHARS = 240;

function definition() {
  return {
    name: 'search_history',
    description:
      "Search this session's own full conversation history (user turns, assistant turns, tool calls, and " +
      'COMPLETE tool results — including parts that were clipped or stubbed out of your visible context). ' +
      'Deterministic keyword search, no model calls. Returns ranked hits with an address (e.g. a tool_use id ' +
      'or "m12.b0") and a short snippet. Pairs with expand_history when that tool is also offered: search ' +
      'locates, expand_history recovers the verbatim text. Best practice: when a context marker says content ' +
      'was clipped or stubbed, search before re-running expensive tools. Limitation: keyword matching only — ' +
      'use distinctive literal terms (identifiers, filenames, error text), not paraphrases.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to find (literal matching, case-insensitive). Distinctive terms work best.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum hits to return (default ' + DEFAULT_MAX_RESULTS + ', cap ' + HARD_MAX_RESULTS + ').',
        },
        kind: {
          type: 'string',
          enum: ['any', 'tool_result', 'tool_use', 'text'],
          description: 'Restrict hits to one entry kind (default any).',
        },
      },
      required: ['query'],
    },
  };
}

function execute(args, ctx) {
  if (!ctx || typeof ctx.getCanonicalMessages !== 'function') {
    return { ok: false, text: 'search_history is unavailable: this run does not expose canonical history.' };
  }
  const query = args && typeof args.query === 'string' ? args.query.trim() : '';
  const terms = queryTerms(query);
  if (!terms.length) {
    return { ok: false, text: 'search_history needs a query with at least one term of 2+ characters.' };
  }

  const messages = ctx.getCanonicalMessages() || [];
  const entries = buildHistoryIndex(messages);
  if (!entries.length) {
    return { ok: true, text: 'History is empty — nothing to search yet.' };
  }

  const phrase = query.toLowerCase();
  const kindFilter = args && typeof args.kind === 'string' ? args.kind : 'any';
  const requested = args && typeof args.max_results === 'number' ? Math.floor(args.max_results) : DEFAULT_MAX_RESULTS;
  const maxResults = Math.min(Math.max(1, requested || DEFAULT_MAX_RESULTS), HARD_MAX_RESULTS);

  const scored = [];
  for (const entry of entries) {
    if (kindFilter === 'tool_result' && entry.kind !== 'tool_result') continue;
    if (kindFilter === 'tool_use' && entry.kind !== 'tool_use') continue;
    if (kindFilter === 'text' && !entry.kind.endsWith('_text')) continue;
    const score = scoreEntry(entry, terms, phrase);
    if (score > 0) scored.push({ entry, score });
  }

  if (!scored.length) {
    return {
      ok: true,
      text:
        'No history entries match ' +
        JSON.stringify(query) +
        '. Try fewer or more literal terms (identifiers, file names, exact error text).',
    };
  }

  // Rank: relevance first, then recency (later canonical index wins ties) so
  // the same query on the same history always returns the same order.
  scored.sort((a, b) => b.score - a.score || b.entry.messageIndex - a.entry.messageIndex);
  const hits = scored.slice(0, maxResults);

  const lines = [hits.length + ' of ' + scored.length + ' matching history entries (query: ' + query + '):'];
  for (const { entry, score } of hits) {
    const label = entry.kind + (entry.toolName ? ' ' + entry.toolName : '');
    lines.push(
      '- id=' +
        entry.address +
        ' [' +
        label +
        ', ' +
        entry.text.length +
        ' chars, score ' +
        score +
        '] ' +
        snippetAround(entry.text, terms, phrase, SNIPPET_CHARS),
    );
  }
  // Same honesty rule as the projection's context markers: never point the
  // model at a tool this run will deny (a --tools allowlist can offer search
  // without expand). Lazy require: tool-catalog loads this module at startup
  // and tool-visibility requires tool-catalog back, so a top-level require
  // here would form a load-order cycle; by execute time both are initialized.
  const { isToolVisible } = require('../tool-visibility');
  lines.push(
    isToolVisible('expand_history', ctx)
      ? 'Recover any entry verbatim with expand_history(id=…).'
      : 'Snippets are truncated; re-run the source tool if you need full content.',
  );
  return { ok: true, text: lines.join('\n') };
}

module.exports = { definition, execute, meta: { name: 'search_history', category: 'read-only' } };
