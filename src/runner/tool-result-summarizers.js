'use strict';

/**
 * E4: deterministic, per-tool boundary summarizers for oversized tool results.
 *
 * Triggered from tool-registry.runAndScrub *after* secret scrubbing has run,
 * so dropped bytes can never contain an un-redacted secret. Each summarizer
 * returns { summary, truncated:true, droppedBytes:number, originalBytes:number }
 * or null when the tool opts out of summarization.
 *
 * Thresholds are tunable via BRIDGE_RUNNER_SUMMARIZE_THRESHOLD; 0 disables.
 */

const DEFAULT_SUMMARIZE_THRESHOLD = 64_000;
const BASH_HEAD_LINES = 1000;
const BASH_TAIL_LINES = 1000;
const SEARCH_MAX_FILES = 50;

function _thresholdBytes() {
  const env = parseInt(process.env.BRIDGE_RUNNER_SUMMARIZE_THRESHOLD, 10);
  if (Number.isFinite(env) && env >= 0) return env;
  return DEFAULT_SUMMARIZE_THRESHOLD;
}

function _bashSummarizer(text) {
  const lines = text.split('\n');
  if (lines.length <= BASH_HEAD_LINES + BASH_TAIL_LINES) return null;
  const head = lines.slice(0, BASH_HEAD_LINES);
  const tail = lines.slice(-BASH_TAIL_LINES);
  const droppedLines = lines.length - BASH_HEAD_LINES - BASH_TAIL_LINES;
  const summary =
    head.join('\n') +
    '\n... [' +
    droppedLines +
    ' middle lines omitted by tool-result summarizer; re-run with a narrower scope to see them]\n... \n' +
    tail.join('\n');
  return {
    summary,
    truncated: true,
    droppedBytes: Buffer.byteLength(text, 'utf8') - Buffer.byteLength(summary, 'utf8'),
    originalBytes: Buffer.byteLength(text, 'utf8'),
  };
}

function _searchTextSummarizer(text) {
  const lines = text.split('\n');
  // search_text format: usually one match per line "path:line:..." — dedupe by path prefix
  const byFile = new Map();
  let nonMatchLines = 0;
  for (const line of lines) {
    const m = line.match(/^([^:]+):(\d+):/);
    if (m) {
      const file = m[1];
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(line);
    } else {
      nonMatchLines++;
    }
  }
  if (byFile.size <= SEARCH_MAX_FILES) return null;
  const kept = [];
  let i = 0;
  for (const [file, matches] of byFile) {
    if (i >= SEARCH_MAX_FILES) break;
    kept.push(matches[0]);
    if (matches.length > 1) kept.push('  ... +' + (matches.length - 1) + ' more match(es) in ' + file);
    i++;
  }
  const extraFiles = byFile.size - SEARCH_MAX_FILES;
  const summary =
    kept.join('\n') + '\n... [' + extraFiles + ' more files with matches; refine pattern or narrow path to see them]';
  return {
    summary,
    truncated: true,
    droppedBytes: Buffer.byteLength(text, 'utf8') - Buffer.byteLength(summary, 'utf8'),
    originalBytes: Buffer.byteLength(text, 'utf8'),
    droppedLines: nonMatchLines,
  };
}

function _listFilesSummarizer(text) {
  const lines = text.split('\n');
  const cap = 500;
  if (lines.length <= cap) return null;
  const head = lines.slice(0, cap);
  const summary =
    head.join('\n') +
    '\n... [' +
    (lines.length - cap) +
    ' more entries truncated by tool-result summarizer; pass a narrower path to paginate]';
  return {
    summary,
    truncated: true,
    droppedBytes: Buffer.byteLength(text, 'utf8') - Buffer.byteLength(summary, 'utf8'),
    originalBytes: Buffer.byteLength(text, 'utf8'),
  };
}

// Tool-name → summarizer. Tools not in the registry pass through unchanged.
// read_file is intentionally excluded: the caller asked for the bytes.
const SUMMARIZERS = {
  bash: _bashSummarizer,
  search_text: _searchTextSummarizer,
  list_files: _listFilesSummarizer,
};

/**
 * Summarize text if it exceeds the threshold AND the tool has a registered
 * summarizer. Returns null when no summarization happened so the caller can
 * keep the original text unchanged.
 */
function maybeSummarize(toolName, text) {
  if (!text || typeof text !== 'string') return null;
  const threshold = _thresholdBytes();
  if (threshold === 0) return null;
  if (Buffer.byteLength(text, 'utf8') < threshold) return null;
  const fn = SUMMARIZERS[toolName];
  if (!fn) return null;
  return fn(text);
}

module.exports = {
  maybeSummarize,
  SUMMARIZERS,
  DEFAULT_SUMMARIZE_THRESHOLD,
};
