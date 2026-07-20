'use strict';

/**
 * undo tool — List backups and restore files from .bridge-runner/backups/.
 *
 * P1-08: writers create timestamped backups
 *   <basename>-<Date.now()>-<seq>-<hex>.bak
 * so this tool looks for that family (newest by mtime), not the obsolete
 * exact <basename>.bak shape. Legacy exact-name backups are still accepted
 * for older fixtures.
 *
 * Auto-approved (no confirmation needed) because it recovers from mistakes.
 * Prefer undo_edit for same-run restores (hash-aware undo log) and
 * local-bridge-undo for whole-run recovery.
 */

const fs = require('fs');
const path = require('path');
const safety = require('../safety');

function definition() {
  return {
    name: 'undo',
    description:
      'List available backups or restore a file from .bridge-runner/backups/. ' +
      'Without a path argument, lists all available backups. ' +
      'With a path argument, restores from the newest matching timestamped backup ' +
      '(writers save <basename>-<timestamp>.bak). Prefer undo_edit for same-run undos.',
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

/**
 * Match writer backups for a relative path. Accepts:
 *   - exact legacy: basename.bak
 *   - timestamped:  basename-<anything>.bak  (saveBackup shape)
 */
function matchingBackups(backupsDir, relPath) {
  const basename = path.basename(relPath);
  const legacyName = basename + '.bak';
  const prefix = basename + '-';
  const matches = [];
  for (const name of fs.readdirSync(backupsDir)) {
    if (!name.endsWith('.bak')) continue;
    if (name === legacyName || name.startsWith(prefix)) {
      const full = path.join(backupsDir, name);
      try {
        const stat = fs.statSync(full);
        matches.push({ name, full, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // skip unreadable
      }
    }
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches;
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
  const confined = safety.confinePath(ctx, args.path);
  if (!confined) {
    return { ok: false, text: 'Path escapes working directory: ' + args.path };
  }

  const matches = matchingBackups(backupsDir, args.path);
  if (matches.length === 0) {
    return { ok: false, text: 'No backup found for: ' + args.path };
  }

  const chosen = matches[0];
  try {
    const backupContent = fs.readFileSync(chosen.full);
    fs.writeFileSync(confined, backupContent);
    return {
      ok: true,
      text:
        'Restored ' +
        args.path +
        ' from backup ' +
        chosen.name +
        ' (' +
        backupContent.length +
        ' bytes)' +
        (matches.length > 1 ? ' — ' + matches.length + ' matching backups; used newest' : ''),
      bytes: backupContent.length,
      backupPath: chosen.full,
    };
  } catch (err) {
    return { ok: false, text: 'Restore error: ' + err.message };
  }
}

module.exports = {
  definition,
  execute,
  matchingBackups,
  meta: { name: 'undo', category: 'recovery' },
};
