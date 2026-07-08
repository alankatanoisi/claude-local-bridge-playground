'use strict';

/**
 * read_file tool — read-only file reader.
 *
 * Reads a file by relative path with limits.
 * Supports line-based paging via offset/limit (1-based lines) with PARTIAL
 * view hints when more content remains.
 */

const fs = require('fs');
const path = require('path');
const fileCache = require('./_file-cache');
const { detectMediaKind, readImageResult, readPdfResult } = require('../media-read');

const MAX_BYTES_DEFAULT = 50000;
const MAX_LINES_DEFAULT = 1000;
const MAX_BYTES_HARD_CAP = 1000000;
const MAX_LINES_HARD_CAP = Math.floor(MAX_BYTES_HARD_CAP / 80);
// B4: above this threshold, return a streaming result so the runner can
// emit incremental `tool_result_chunk` events. The final text is still
// assembled in tool-registry.runAndScrub for transcript + API payload.
const STREAM_THRESHOLD_BYTES = 100_000;

function getLimit(value, fallback, hardCap) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), hardCap);
}

function getLineNumber(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function readPrefix(target, byteLimit) {
  const buffer = Buffer.alloc(byteLimit);
  const fd = fs.openSync(target, 'r');

  try {
    const bytesRead = fs.readSync(fd, buffer, 0, byteLimit, 0);
    return { bytesRead, text: buffer.subarray(0, bytesRead).toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

async function* streamPrefix(target, byteLimit) {
  const stream = fs.createReadStream(target, { end: byteLimit - 1, encoding: 'utf8' });
  for await (const chunk of stream) {
    yield chunk;
  }
}

function iterateFileLines(target, onLine) {
  const fd = fs.openSync(target, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return 0;

    const buf = Buffer.alloc(64 * 1024);
    let pos = 0;
    let leftover = '';
    let lineNo = 0;

    while (pos < size) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      pos += n;
      const chunk = leftover + buf.subarray(0, n).toString('utf8');
      const parts = chunk.split('\n');
      leftover = parts.pop() ?? '';
      for (const line of parts) {
        lineNo += 1;
        onLine(lineNo, line);
      }
    }

    lineNo += 1;
    onLine(lineNo, leftover);
    return lineNo;
  } finally {
    fs.closeSync(fd);
  }
}

function formatNumberedLines(rows) {
  if (!rows.length) return '';
  const endLine = rows[rows.length - 1].lineNo;
  const width = String(endLine).length;
  return rows.map(({ lineNo, line }) => String(lineNo).padStart(width, ' ') + '|' + line).join('\n');
}

function buildPartialFooter({ startLine, endLine, totalLines, nextOffset, reason }) {
  const lines = [];
  if (totalLines !== null && totalLines !== undefined && totalLines > 0) {
    lines.push(`[PARTIAL: lines ${startLine}-${endLine} of ${totalLines} total]`);
  } else if (endLine >= startLine) {
    lines.push(`[PARTIAL: lines ${startLine}-${endLine}]`);
  } else {
    lines.push('[PARTIAL: empty view]');
  }
  if (nextOffset) {
    lines.push(`To read more, call read_file with offset=${nextOffset}.`);
  }
  if (reason) lines.push(reason);
  return lines.join('\n');
}

function readLineWindow(target, offset, limit) {
  const rows = [];
  let totalLines = 0;
  let hasMore = false;

  iterateFileLines(target, (lineNo, line) => {
    totalLines = lineNo;
    if (lineNo < offset) return;
    if (rows.length >= limit) {
      hasMore = true;
      return;
    }
    rows.push({ lineNo, line });
  });

  if (offset > totalLines && totalLines > 0) {
    return {
      ok: true,
      text: buildPartialFooter({
        startLine: offset,
        endLine: offset - 1,
        totalLines,
        reason: `offset ${offset} is past end of file (${totalLines} lines).`,
      }),
      bytes: fs.statSync(target).size,
      partial: true,
    };
  }

  const body = formatNumberedLines(rows);
  const startLine = rows.length ? rows[0].lineNo : offset;
  const endLine = rows.length ? rows[rows.length - 1].lineNo : offset - 1;
  const nextOffset = hasMore || (totalLines > 0 && endLine < totalLines) ? endLine + 1 : null;

  let text = body;
  if (nextOffset || totalLines > rows.length) {
    const footer = buildPartialFooter({
      startLine,
      endLine,
      totalLines: totalLines || null,
      nextOffset,
    });
    text = text ? text + '\n\n' + footer : footer;
  }

  return {
    ok: true,
    text,
    bytes: fs.statSync(target).size,
    partial: !!nextOffset,
    truncated: !!nextOffset,
    offset: nextOffset,
  };
}

function definition() {
  return {
    name: 'read_file',
    description:
      'Read the contents of a file by relative path. Text files support offset/limit paging. ' +
      'Images (.png, .jpg, .gif, .webp) and PDFs return multimodal blocks for the model. ' +
      'Respects max_bytes (default 50KB) and max_lines (default 1000).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file inside the project',
        },
        offset: {
          type: 'number',
          description: '1-based line number to start reading from (default: 1)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return (defaults to max_lines)',
        },
        max_bytes: {
          type: 'number',
          description: 'Maximum bytes to read (default: 50000)',
        },
        max_lines: {
          type: 'number',
          description: 'Maximum lines to read (default: 1000)',
        },
      },
      required: ['path'],
    },
  };
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  if (!args || typeof args.path !== 'string' || args.path.trim() === '') {
    return { ok: false, text: 'Missing required path argument for read_file.' };
  }
  const target = path.resolve(cwd, args.path);

  try {
    const stats = fs.statSync(target);
    if (!stats.isFile()) {
      return { ok: false, text: `Not a file: ${args.path}` };
    }

    if (stats.size === 0) {
      const kind = detectMediaKind(args.path);
      if (kind === 'text') return { ok: true, text: '(empty file)', bytes: 0 };
      return { ok: false, text: 'Empty ' + kind + ' file: ' + args.path };
    }

    const mediaKind = detectMediaKind(args.path);
    if (mediaKind === 'image') {
      return readImageResult(target, args.path, stats);
    }
    if (mediaKind === 'pdf') {
      return readPdfResult(target, args.path, stats);
    }

    const maxBytes = getLimit(args.max_bytes, MAX_BYTES_DEFAULT, MAX_BYTES_HARD_CAP);
    const maxLines = getLimit(args.max_lines, MAX_LINES_DEFAULT, MAX_LINES_HARD_CAP);
    const lineLimit = getLimit(args.limit, maxLines, MAX_LINES_HARD_CAP);
    const startLine = getLineNumber(args.offset, 1);
    const explicitPaging = startLine > 1 || (args.limit !== undefined && args.limit !== null);

    if (explicitPaging) {
      return readLineWindow(target, startLine, lineLimit);
    }

    // Try the shared file cache first. It only serves files that fit under
    // its per-entry cap; oversize files fall through to the bounded prefix
    // read path below. Returning null means "miss or uncacheable."
    const cached = fileCache.readCached(target);
    let bytesRead;
    let text;
    if (cached) {
      const slice = cached.subarray(0, Math.min(cached.length, maxBytes));
      bytesRead = slice.length;
      text = slice.toString('utf8');
    } else {
      const byteLimit = Math.min(stats.size, maxBytes);
      // B4: stream when the read is large enough to benefit from chunked
      // emission. tool-registry.runAndScrub coalesces the stream into the
      // final text while applying the secret scrubber across chunk
      // boundaries.
      if (byteLimit > STREAM_THRESHOLD_BYTES) {
        return {
          ok: true,
          isStreaming: true,
          stream: streamPrefix(target, byteLimit),
          bytes: stats.size,
        };
      }
      const fresh = readPrefix(target, byteLimit);
      bytesRead = fresh.bytesRead;
      text = fresh.text;
    }

    const truncatedByBytes = stats.size > bytesRead;
    if (truncatedByBytes) {
      // Byte limits can stop in the middle of one UTF-8 character.
      if (text.endsWith('\uFFFD')) text = text.slice(0, -1);
    }

    const allLines = text.split('\n');
    const hasTrailingNewline = text.endsWith('\n');
    const contentLines = hasTrailingNewline ? allLines.slice(0, -1) : allLines;
    const truncatedByLines = contentLines.length > maxLines;
    const windowLines = truncatedByLines ? contentLines.slice(0, maxLines) : contentLines;

    const rows = windowLines.map((line, index) => ({ lineNo: index + 1, line }));
    text = formatNumberedLines(rows);

    if (truncatedByLines) {
      const footer = buildPartialFooter({
        startLine: 1,
        endLine: maxLines,
        totalLines: truncatedByBytes ? null : contentLines.length,
        nextOffset: maxLines + 1,
        reason: truncatedByBytes
          ? 'Earlier lines only — file continues beyond max_bytes; increase max_bytes or use offset paging.'
          : null,
      });
      text = text + '\n\n' + footer;
      return {
        ok: true,
        text,
        bytes: stats.size,
        partial: true,
        truncated: true,
        offset: maxLines + 1,
      };
    }

    if (truncatedByBytes) {
      text +=
        '\n\n' +
        buildPartialFooter({
          startLine: 1,
          endLine: windowLines.length,
          totalLines: null,
          nextOffset: windowLines.length + 1,
          reason: 'Truncated by max_bytes. Use offset/limit paging or raise max_bytes.',
        });
      return {
        ok: true,
        text,
        bytes: stats.size,
        partial: true,
        truncated: true,
        offset: windowLines.length + 1,
      };
    }

    return { ok: true, text, bytes: stats.size };
  } catch (err) {
    return { ok: false, text: `Error: ${err.message}` };
  }
}

module.exports = { definition, execute, meta: { name: 'read_file', category: 'read-only' } };
