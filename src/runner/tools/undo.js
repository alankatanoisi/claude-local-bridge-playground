'use strict';

/**
 * undo tool — List backups and restore files from .bridge-runner/backups/.
 *
 * Auto-approved (no confirmation needed) because it recovers from mistakes.
 */

const fs = require('fs');
const path = require('path');

function definition() {
  return {
    name: 'undo',
    description:
      'List available backups or restore a file from .bridge-runner/backups/. ' +
      'Without a path argument, lists all available backups. ' +
      'With a path argument, restores the specified file from the most recent backup.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to restore, or omit to list all backups',
        },
      },
      required: [],
    },
  };
}

function getBackupsDir(cwd) {
  return path.join(cwd, '.bridge-runner', 'backups');
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const backupsDir = getBackupsDir(cwd);

  if (!fs.existsSync(backupsDir)) {
    return { ok: true, text: 'No backups found. .bridge-runner/backups/ does not exist yet.' };
  }

  const backupFiles = fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith('.bak'))
    .sort();

  // List mode — no path argument
  if (!args || !args.path) {
    if (backupFiles.length === 0) {
      return { ok: true, text: 'No backups available.' };
    }
    const listing = backupFiles.map((f) => {
      const stat = fs.statSync(path.join(backupsDir, f));
      const size = stat.size;
      const time = stat.mtime.toISOString();
      return f + '  (' + size + ' bytes, ' + time + ')';
    });
    return { ok: true, text: 'Available backups:\n' + listing.join('\n') };
  }

  // Restore mode — path argument
  const targetBasename = path.basename(args.path) + '.bak';
  const backupPath = path.join(backupsDir, targetBasename);

  if (!fs.existsSync(backupPath)) {
    return { ok: false, text: 'No backup found for: ' + args.path };
  }

  const targetPath = path.resolve(cwd, args.path);

  try {
    const backupContent = fs.readFileSync(backupPath);
    fs.writeFileSync(targetPath, backupContent);
    return {
      ok: true,
      text: 'Restored ' + args.path + ' from backup (' + backupContent.length + ' bytes)',
      bytes: backupContent.length,
    };
  } catch (err) {
    return { ok: false, text: 'Restore error: ' + err.message };
  }
}

module.exports = { definition, execute };
