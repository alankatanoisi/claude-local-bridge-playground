'use strict';

/**
 * expand_history tool — recover a verbatim span of this session's canonical
 * history by address. Read-only; `history` capability group.
 *
 * The recovery half of research review 2026-08-31 ideas 5+6 (Scroll): when
 * the projection clips an old tool result, the marker now names the block's
 * id and points here. Canonical history is lossless in memory, so recovery is
 * a slice, not a re-run. Paged via offset/max_chars so a huge result cannot
 * blow the context that clipping just saved.
 *
 * Output passes the central redaction boundary (runAndScrub) like every tool:
 * "verbatim" means byte-faithful up to secret redaction, never around it.
 */

const { buildHistoryIndex, resolveAddress } = require('./_history-index');

const DEFAULT_MAX_CHARS = 20_000;
const HARD_MAX_CHARS = 50_000;
const MIN_MAX_CHARS = 200;

function definition() {
  return {
    name: 'expand_history',
    description:
      'Recover the verbatim text of an earlier history entry that was clipped, stubbed, or scrolled out of ' +
      'your visible context. `id` is a tool_use id (from a context marker like "recover: expand_history ' +
      'id=…" or a search_history hit) or an address like "m12" / "m12.b0". Large entries are paged: pass ' +
      '`offset` to continue where the previous call stopped. Pairs with search_history (locate first when ' +
      'you do not have an id). Best practice: prefer this over re-running an expensive tool when the old ' +
      'output is still valid; if a marker says a read is STALE, re-read the file instead — the bytes here ' +
      'are historical.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Entry address: a tool_use id, "m<index>", or "m<index>.b<block>".',
        },
        offset: {
          type: 'number',
          description: 'Character offset to start from (default 0; use the next_offset a previous call reported).',
        },
        max_chars: {
          type: 'number',
          description: 'Maximum characters to return (default ' + DEFAULT_MAX_CHARS + ', cap ' + HARD_MAX_CHARS + ').',
        },
      },
      required: ['id'],
    },
  };
}

function execute(args, ctx) {
  if (!ctx || typeof ctx.getCanonicalMessages !== 'function') {
    return { ok: false, text: 'expand_history is unavailable: this run does not expose canonical history.' };
  }
  const id = args && typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) {
    return { ok: false, text: 'expand_history needs an id (a tool_use id, "m<index>", or "m<index>.b<block>").' };
  }

  const messages = ctx.getCanonicalMessages() || [];
  const entries = buildHistoryIndex(messages);
  const matches = resolveAddress(entries, id);
  if (!matches.length) {
    return {
      ok: false,
      text:
        'No history entry found for id ' +
        JSON.stringify(id) +
        '. Use search_history to locate entries, or check the id spelling from the context marker.',
    };
  }

  // A whole-message address ("m12") can name several blocks; join them with
  // block headers so the addresses for finer-grained follow-ups are visible.
  const text =
    matches.length === 1
      ? matches[0].text
      : matches.map((entry) => '[' + entry.address + ' ' + entry.kind + ']\n' + entry.text).join('\n\n');

  const requestedMax = args && typeof args.max_chars === 'number' ? Math.floor(args.max_chars) : DEFAULT_MAX_CHARS;
  const maxChars = Math.min(Math.max(MIN_MAX_CHARS, requestedMax || DEFAULT_MAX_CHARS), HARD_MAX_CHARS);
  const requestedOffset = args && typeof args.offset === 'number' ? Math.floor(args.offset) : 0;
  const offset = Math.min(Math.max(0, requestedOffset), text.length);

  const slice = text.slice(offset, offset + maxChars);
  const end = offset + slice.length;
  const first = matches[0];
  const label = first.kind + (first.toolName ? ' ' + first.toolName : '');

  const header =
    '[history ' + first.address + ' ' + label + ' chars=' + text.length + ' span=' + offset + '..' + end + ']';
  const footer =
    end < text.length
      ? '\n[… ' + (text.length - end) + ' more chars: call expand_history id=' + id + ' offset=' + end + ']'
      : '';

  return { ok: true, text: header + '\n' + slice + footer, bytes: Buffer.byteLength(slice, 'utf8') };
}

module.exports = { definition, execute, meta: { name: 'expand_history', category: 'read-only' } };
