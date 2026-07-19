'use strict';

// undo_edit is the runner's small "oops button": it restores the backup saved
// for a previous write/edit tool call during the current run.

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { atomicWriteFile, sha256Text } = require('./file-write-utils');

function definition() {
  return {
    name: 'undo_edit',
    description:
      'Undo a previous edit_file or write_file call from the current run. ' +
      'Pass tool_use_id to undo a specific tool call, or path to undo the most recent change to that file.',
    input_schema: {
      type: 'object',
      properties: {
        tool_use_id: {
          type: 'string',
          description: 'The tool_use_id of the edit/write call to undo',
        },
        path: {
          type: 'string',
          description: 'Relative path to undo, if tool_use_id is not known',
        },
      },
      required: [],
    },
  };
}

function findEntry(args, undoLog) {
  const entries = Array.isArray(undoLog) ? undoLog.slice().reverse() : [];
  if (args && args.tool_use_id) {
    return entries.find((entry) => entry.tool_use_id === args.tool_use_id);
  }
  if (args && args.path) {
    return entries.find((entry) => entry.path === args.path);
  }
  return entries[0];
}

/**
 * Compare two absolute paths for "same file" purposes. Plain string equality
 * first; if that fails, fall back to realpath so symlinked temp dirs (macOS
 * /var -> /private/var) don't cause false refusals.
 */
function samePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  try {
    return fs.realpathSync(ra) === fs.realpathSync(rb);
  } catch {
    // One of the paths doesn't exist — realpath the deepest existing parent
    // instead, so a not-yet-recreated file still compares correctly.
    try {
      return realpathAnchor(ra) === realpathAnchor(rb);
    } catch {
      return false;
    }
  }
}

function realpathAnchor(p) {
  let anchor = p;
  const suffix = [];
  while (anchor !== path.dirname(anchor) && !fs.existsSync(anchor)) {
    suffix.unshift(path.basename(anchor));
    anchor = path.dirname(anchor);
  }
  return path.join(fs.realpathSync(anchor), ...suffix);
}

function execute(args, ctx) {
  const entry = findEntry(args || {}, ctx && ctx.undoLog);
  if (!entry) {
    return {
      ok: false,
      text: 'No undo entry found for this run.',
    };
  }

  if (!entry.backup_path) {
    return {
      ok: false,
      text: 'Cannot undo ' + entry.path + ': no backup was needed for the original write.',
    };
  }

  if (!fs.existsSync(entry.backup_path)) {
    return {
      ok: false,
      text: 'Cannot undo ' + entry.path + ': backup file is missing.',
    };
  }

  // P0-10: the write target is ALWAYS the confined path — entry.path resolved
  // against the CURRENT working root. entry.absolute_path was recorded under
  // whatever root was active at write time, and worktree enter/exit can move
  // the root out from under it, so it is advisory metadata only.
  const confined = safety.confinePath(ctx, entry.path);
  if (!confined) {
    return { ok: false, text: 'Undo target path escapes working directory: ' + entry.path };
  }

  // If the recorded absolute path no longer matches where entry.path resolves
  // today, the root changed since the edit. Refuse rather than guess: writing
  // the old absolute path would escape the current root, and writing the
  // confined path would clobber an unrelated same-named file in the new root.
  if (entry.absolute_path && !samePath(entry.absolute_path, confined)) {
    return {
      ok: false,
      text:
        'Cannot undo ' +
        entry.path +
        ': the edit was recorded at ' +
        entry.absolute_path +
        ' but that path now resolves to ' +
        confined +
        ' — the working root changed since the edit (worktree enter/exit). ' +
        'Return to the original root and retry.',
    };
  }
  const target = confined;
  const backupContent = fs.readFileSync(entry.backup_path, 'utf8');

  try {
    atomicWriteFile(target, backupContent);
    return {
      ok: true,
      text:
        'Restored ' +
        entry.path +
        ' from undo entry ' +
        (entry.tool_use_id || '(no tool_use_id)') +
        '. restored_sha256=' +
        sha256Text(backupContent),
      bytes: Buffer.byteLength(backupContent, 'utf8'),
    };
  } catch (err) {
    return { ok: false, text: 'Undo error: ' + err.message };
  }
}

module.exports = { definition, execute, meta: { name: 'undo_edit', category: 'recovery' } };
