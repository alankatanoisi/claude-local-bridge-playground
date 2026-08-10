'use strict';

/**
 * undo tool — List backups and restore files from .bridge-runner/backups/.
 *
 * P1-08: writers create timestamped backups
 *   <basename>-<Date.now()>-<seq>-<hex>.bak
 * so this tool looks for that family (newest by mtime, then sequence when the
 * mtimes tie), not only the obsolete exact <basename>.bak shape. Legacy
 * exact-name backups are still accepted for older runs and fixtures.
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
      '(writers save <basename>-<timestamp>-<sequence>-<random>.bak). ' +
      'Prefer undo_edit for same-run undos.',
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
 * Read the monotonic sequence from the exact filename shape saveBackup() writes:
 *
 *   <basename>-<Date.now()>-<base36 sequence>-<six hex characters>.bak
 *
 * Older backups do not contain this sequence. Returning null for those names is
 * important: undo must keep accepting legacy backups without pretending that an
 * unrelated dash-separated number is a trustworthy creation order.
 */
function currentBackupSequence(name, prefix) {
  if (!name.startsWith(prefix) || !name.endsWith('.bak')) return null;

  const writerSuffix = name.slice(prefix.length, -'.bak'.length);
  const match = writerSuffix.match(/^\d+-([0-9a-z]+)-[0-9a-f]{6}$/);
  if (!match) return null;

  const sequence = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(sequence) ? sequence : null;
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
        matches.push({
          name,
          full,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          sequence: currentBackupSequence(name, prefix),
        });
      } catch {
        // skip unreadable
      }
    }
  }
  matches.sort((a, b) => {
    // Filesystem modification time remains the primary "newest" signal so old
    // exact-name and older timestamped backups keep their historical behavior.
    const byMtime = b.mtimeMs - a.mtimeMs;
    if (byMtime !== 0) return byMtime;

    // A coarse filesystem can give two successive writes the same mtime. When
    // both files came from the current writer, its monotonic counter tells us
    // which backup was actually created later.
    if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) {
      return a.sequence > b.sequence ? -1 : 1;
    }

    // Legacy names have no trustworthy sequence. A bytewise name comparison
    // gives tied legacy/mixed entries a stable result on every filesystem while
    // leaving the single exact `<basename>.bak` recovery path fully supported.
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
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
