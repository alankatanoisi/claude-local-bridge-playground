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

function saveBackup(filePath, contentBuffer) {
  const backupsDir = path.join(path.dirname(filePath), '..', '.bridge-runner', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const backupPath = path.join(backupsDir, path.basename(filePath) + '.bak');
  fs.writeFileSync(backupPath, contentBuffer);
  return backupPath;
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const target = path.resolve(cwd, args.path);
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

  if (existed) {
    try {
      backupPath = saveBackup(target, fs.readFileSync(target));
    } catch {
      // Non-fatal: continue writing even if backup fails
    }
  }

  try {
    fs.writeFileSync(target, content, 'utf8');
  } catch (err) {
    return { ok: false, text: 'Write error: ' + err.message };
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  const msg = existed
    ? 'File overwritten (' + bytes + ' bytes). Backup saved to ' + backupPath
    : 'File created (' + bytes + ' bytes)';

  return { ok: true, text: msg, bytes };
}

module.exports = { definition, execute };
