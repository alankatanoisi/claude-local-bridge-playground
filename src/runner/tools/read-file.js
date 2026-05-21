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

    const maxBytes = Math.min(args.max_bytes || MAX_BYTES_DEFAULT, MAX_BYTES_HARD_CAP);
    const maxLines = Math.min(args.max_lines || MAX_LINES_DEFAULT, MAX_BYTES_HARD_CAP / 80);

    const buffer = fs.readFileSync(target, 'utf8');
    let text = buffer;

    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      text = text.slice(0, maxBytes);
      // Trim to last full UTF-8 char to avoid corruption
      while (Buffer.byteLength(text, 'utf8') > maxBytes) {
        text = text.slice(0, -1);
      }
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
