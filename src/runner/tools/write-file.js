'use strict';

/**
 * write_file tool — Create or overwrite a file with full content.
 *
 * If the file already exists, it is overwritten. A backup is saved before
 * overwriting so the user can recover.
 *
 * Respects the 50KB content limit to avoid huge writes.
 */

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { atomicWriteFile, recordUndo, saveBackup, sha256Text } = require('./file-write-utils');

const MAX_CONTENT_BYTES = 50000;

function definition() {
  return {
    name: 'write_file',
    description:
      'Create a new file or overwrite an existing file with the given content. ' +
      'A backup of any existing file is saved before overwriting. ' +
      'Content is limited to 50KB.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file inside the project',
        },
        content: {
          type: 'string',
          description: 'Full content to write into the file',
        },
      },
      required: ['path', 'content'],
    },
  };
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();

  if (!args || typeof args.content !== 'string') {
    return { ok: false, text: 'Missing required content argument for write_file.' };
  }

  const confined = safety.confinePath(ctx, args.path);
  if (!confined) {
    return { ok: false, text: 'Path escapes working directory: ' + args.path };
  }
  const target = confined;
  const content = args.content;

  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    return {
      ok: false,
      text: 'Content too large: ' + Buffer.byteLength(content, 'utf8') + ' bytes (max ' + MAX_CONTENT_BYTES + ')',
    };
  }

  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      return { ok: false, text: 'Cannot create directory: ' + err.message };
    }
  }

  const existed = fs.existsSync(target);
  let backupPath = null;
  let originalHash = null;

  if (existed) {
    try {
      const original = fs.readFileSync(target);
      originalHash = sha256Text(original.toString('utf8'));
      backupPath = saveBackup(target, original, cwd);
    } catch {
      // Non-fatal: continue writing even if backup fails
    }
  }

  try {
    atomicWriteFile(target, content);
  } catch (err) {
    return { ok: false, text: 'Write error: ' + err.message };
  }

  recordUndo(ctx, {
    path: args.path,
    absolute_path: target,
    backup_path: backupPath,
    original_sha256: originalHash,
    new_sha256: sha256Text(content),
    tool: 'write_file',
  });

  const bytes = Buffer.byteLength(content, 'utf8');
  const msg = existed
    ? 'File overwritten (' + bytes + ' bytes). Backup saved to ' + backupPath
    : 'File created (' + bytes + ' bytes)';

  return { ok: true, text: msg, bytes, backupPath, new_hash: sha256Text(content) };
}

module.exports = { definition, execute };
