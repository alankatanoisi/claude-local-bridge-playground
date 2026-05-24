'use strict';

/**
 * Tool result envelope — normalized shape for runner telemetry.
 */

function normalizeToolResult(raw, meta = {}) {
  const text = raw.text || '';
  const truncated = !!raw.truncated || !!meta.truncated;
  let modelText = text;

  if (truncated && meta.refreshHint) {
    modelText = text + '\n' + meta.refreshHint;
  } else if (truncated && meta.offset !== undefined) {
    modelText =
      text +
      '\n[Output truncated at ' +
      (meta.bytes || text.length) +
      ' bytes. Run read_file with offset ' +
      meta.offset +
      ' to continue.]';
  }

  return {
    ok: !!raw.ok,
    text: modelText,
    summary: meta.summary || (text.length > 200 ? text.slice(0, 200) + '...' : text),
    data: meta.data || null,
    bytes: meta.bytes ?? (text ? Buffer.byteLength(text, 'utf8') : 0),
    truncated,
    refreshHint: meta.refreshHint || null,
    safetyTags: meta.safetyTags || [],
    permission: meta.permission || null,
    effect: meta.effect || null,
    timing_ms: meta.timing_ms || 0,
    canonicalTool: meta.canonicalTool || meta.toolName,
    aliasUsed: meta.aliasUsed || null,
  };
}

/** Map legacy alias names to canonical tool names. */
const TOOL_ALIASES = Object.freeze({
  read: 'read_file',
  write: 'write_file',
  list: 'list_files',
  search: 'search_text',
  patch: 'apply_patch',
});

function resolveToolName(name) {
  const canonical = TOOL_ALIASES[name] || name;
  return { canonical, aliasUsed: canonical !== name ? name : null };
}

module.exports = {
  normalizeToolResult,
  TOOL_ALIASES,
  resolveToolName,
};
