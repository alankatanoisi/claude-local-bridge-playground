'use strict';

/**
 * repeat-tool-detector.js — Small per-run detector for "same read again" loops.
 *
 * This is deliberately advisory. It warns the human and nudges the model, but
 * it does not stop the run. The existing semantic-cycle guard still owns hard
 * stops for true loops.
 */

const path = require('path');

const READ_FILE_DEFAULT_OFFSET = 1;
const READ_FILE_DEFAULT_MAX_LINES = 1000;
const READ_FILE_DEFAULT_MAX_BYTES = 50000;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW = 12;

function positiveIntegerOr(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeReadFileRange(toolUse, ctx = {}) {
  if (!toolUse || toolUse.name !== 'read_file') return null;
  const args = toolUse.input || {};
  if (typeof args.path !== 'string' || args.path.trim() === '') return null;

  const cwd = ctx.cwdRealpath || ctx.cwd || process.cwd();
  const absolutePath = path.resolve(cwd, args.path);
  const relativePath = path.relative(cwd, absolutePath) || '.';

  // read_file treats `limit` as the line-window size when present. If `limit`
  // is absent, `max_lines` is the line cap for the default prefix read.
  const offset = positiveIntegerOr(args.offset, READ_FILE_DEFAULT_OFFSET);
  const limit = positiveIntegerOr(args.limit ?? args.max_lines, READ_FILE_DEFAULT_MAX_LINES);
  const maxBytes = positiveIntegerOr(args.max_bytes, READ_FILE_DEFAULT_MAX_BYTES);

  const key = ['read_file', relativePath, 'offset=' + offset, 'limit=' + limit, 'max_bytes=' + maxBytes].join('|');

  return {
    key,
    path: relativePath,
    offset,
    limit,
    maxBytes,
  };
}

function formatRepeatWarningNote(warning) {
  if (!warning) return '';
  return (
    '[runner warning: repeated read_file range] ' +
    warning.message +
    ' Use the current result, search_text for a narrower target, or move to edit/write once you have enough context.'
  );
}

function createRepeatToolDetector(policy = {}) {
  const threshold = positiveIntegerOr(policy.threshold, DEFAULT_THRESHOLD);
  const window = positiveIntegerOr(policy.window, DEFAULT_WINDOW);
  const history = [];
  const warned = new Set();

  function noteToolResult(step, toolUse, result, ctx = {}) {
    const range = normalizeReadFileRange(toolUse, ctx);
    if (!range) return null;

    const compactionGeneration = positiveIntegerOr(ctx.compactionGeneration, 0);
    const entry = {
      step,
      toolUseId: toolUse.id,
      range,
      ok: !!result?.ok,
      compactionGeneration,
    };
    history.push(entry);

    // Keep only the recent read history. Old repeats should not make a later
    // legitimate re-read look suspicious.
    while (history.length > window) history.shift();

    const matches = history.filter((item) => item.range.key === range.key);
    if (matches.length < threshold) return null;

    // Warn once for each repeated range per compaction generation. If a later
    // compaction changes the context again, the same range can warn again.
    const warnedKey = range.key + '|compaction=' + compactionGeneration;
    if (warned.has(warnedKey)) return null;
    warned.add(warnedKey);

    const compactionPart = compactionGeneration > 0 ? ' after compaction generation ' + compactionGeneration : '';
    const message =
      'This is read #' +
      matches.length +
      ' of ' +
      range.path +
      ' offset=' +
      range.offset +
      ' limit=' +
      range.limit +
      ' max_bytes=' +
      range.maxBytes +
      compactionPart +
      '.';

    return {
      kind: 'repeat_read_file_range',
      message,
      step,
      tool_use_id: toolUse.id,
      tool: 'read_file',
      count: matches.length,
      threshold,
      window,
      path: range.path,
      offset: range.offset,
      limit: range.limit,
      max_bytes: range.maxBytes,
      compactionGeneration,
      afterCompaction: compactionGeneration > 0,
      firstStep: matches[0].step,
      lastStep: matches[matches.length - 1].step,
    };
  }

  return {
    noteToolResult,
    history() {
      return history.slice();
    },
  };
}

module.exports = {
  createRepeatToolDetector,
  formatRepeatWarningNote,
  normalizeReadFileRange,
};
