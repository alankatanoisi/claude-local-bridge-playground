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

  const cwd = (ctx && ctx.cwd) || process.cwd();
  const target = entry.absolute_path || path.resolve(cwd, entry.path);

  // Validate that the restore target hasn't escaped the project
  const confined = safety.confinePath(ctx, entry.path);
  if (!confined) {
    return { ok: false, text: 'Undo target path escapes working directory: ' + entry.path };
  }
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

module.exports = { definition, execute };
