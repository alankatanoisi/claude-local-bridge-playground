'use strict';

/**
 * read_file tool — read-only file reader.
 *
 * Reads a file by relative path with limits.
 * Enforces max_bytes and max_lines to avoid huge dumps.
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES_DEFAULT = 50000;
const MAX_LINES_DEFAULT = 1000;
const MAX_BYTES_HARD_CAP = 1000000;
const MAX_LINES_HARD_CAP = Math.floor(MAX_BYTES_HARD_CAP / 80);

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
    const { bytesRead, text: prefix } = readPrefix(target, Math.min(stats.size, maxBytes));
    let text = prefix;

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
