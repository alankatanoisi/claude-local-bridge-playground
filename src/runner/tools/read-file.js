'use strict';

/**
 * read_file tool — read-only file reader.
 *
 * Reads a file by relative path with limits.
 * Enforces max_bytes and max_lines to avoid huge dumps.
 */

const fs = require('fs');
const path = require('path');
const fileCache = require('./_file-cache');

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

function definition() {
  return {
    name: 'read_file',
    description:
      'Read the contents of a file by relative path. ' +
      'Respects max_bytes (default 50KB) and max_lines (default 1000).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file inside the project',
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

    const maxBytes = getLimit(args.max_bytes, MAX_BYTES_DEFAULT, MAX_BYTES_HARD_CAP);
    const maxLines = getLimit(args.max_lines, MAX_LINES_DEFAULT, MAX_LINES_HARD_CAP);

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

    if (stats.size > bytesRead) {
      // Byte limits can stop in the middle of one UTF-8 character.
      if (text.endsWith('\uFFFD')) text = text.slice(0, -1);
      text += '\n... (truncated by max_bytes)';
    }

    const lines = text.split('\n');
    if (lines.length > maxLines) {
      text = lines.slice(0, maxLines).join('\n') + '\n... (truncated by max_lines)';
    }

    return { ok: true, text, bytes: stats.size };
  } catch (err) {
    return { ok: false, text: `Error: ${err.message}` };
  }
}

module.exports = { definition, execute };
