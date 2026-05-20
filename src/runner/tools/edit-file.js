'use strict';

/**
 * edit_file tool — Exact string replacement with diff display.
 *
 * Searches for old_string in the file. The match must be unique (exactly
 * one occurrence). After the match is confirmed, replaces old_string
 * with new_string and writes the file back.
 *
 * Writes to .bridge-runner/backups/<filename>.bak before modifying,
 * so the user can recover via file diff or git.
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteFile, recordUndo, saveBackup, sha256Text } = require('./file-write-utils');

function definition() {
  return {
    name: 'edit_file',
    description:
      'Replace one occurrence of old_string with new_string in a file. ' +
      'The old_string must match exactly once in the file. ' +
      'A backup is saved before the edit.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file inside the project',
        },
        old_string: {
          type: 'string',
          description: 'Exact text to replace — must match only once',
        },
        new_string: {
          type: 'string',
          description: 'Text to insert in place of old_string',
        },
        expected_sha256: {
          type: 'string',
          description: 'Optional SHA-256 hash of the current file content. If it differs, the edit is refused.',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence of old_string. Defaults to false, which requires exactly one match.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  };
}

// Build a simple unified-diff-style preview of what will change
function buildDiffPreview(lines, matchLine, oldStr, newStr) {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  // Show a few context lines around the match
  const contextBefore = 2;
  const contextAfter = 2;
  const start = Math.max(0, matchLine - contextBefore);
  const end = Math.min(lines.length, matchLine + oldLines.length + contextAfter);

  const diff = [];
  diff.push('--- a/file');
  diff.push('+++ b/file');
  diff.push('@@ -' + (matchLine + 1) + ',' + oldLines.length + ' +' + (matchLine + 1) + ',' + newLines.length + ' @@');

  for (let i = start; i < end; i++) {
    if (i >= matchLine && i < matchLine + oldLines.length) {
      // Old lines being removed
      diff.push('-' + lines[i]);
    }
    if (i >= matchLine && i < matchLine + newLines.length && i - matchLine < newLines.length) {
      // New lines being added
      diff.push('+' + (newLines[i - matchLine] || ''));
    }
    if (i < matchLine || i >= matchLine + oldLines.length) {
      // Context lines (unchanged)
      diff.push(' ' + lines[i]);
    }
  }
  return diff.join('\n');
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const target = path.resolve(cwd, args.path);

  try {
    // Read the current file
    const original = fs.readFileSync(target, 'utf8');
    const oldStr = args.old_string;
    const currentHash = sha256Text(original);

    if (!oldStr) {
      return { ok: false, text: 'old_string must not be empty.' };
    }

    if (args.expected_sha256 && args.expected_sha256 !== currentHash) {
      return {
        ok: false,
        text:
          'Hash guard failed for ' +
          args.path +
          '. current_sha256=' +
          currentHash +
          ' expected_sha256=' +
          args.expected_sha256,
        current_hash: currentHash,
      };
    }

    // Count occurrences of old_string — must match exactly once
    let idx = 0;
    let count = 0;
    let matchIndex = -1;
    while (idx < original.length) {
      const found = original.indexOf(oldStr, idx);
      if (found === -1) break;
      count++;
      matchIndex = found;
      idx = found + 1;
    }

    if (count === 0) {
      return {
        ok: false,
        text: 'old_string not found in file. Make sure you are using the exact text from the file, including whitespace.',
      };
    }

    if (count > 1 && !args.replace_all) {
      // Find the line numbers of each match to help the user narrow down
      const lineNumbers = [];
      let searchFrom = 0;
      while (searchFrom < original.length) {
        const found = original.indexOf(oldStr, searchFrom);
        if (found === -1) break;
        const lineNum = original.slice(0, found).split('\n').length;
        lineNumbers.push(lineNum);
        searchFrom = found + 1;
      }
      return {
        ok: false,
        text:
          'old_string matched ' +
          count +
          ' times in the file. Include more surrounding context to make it unique. ' +
          'Matches found at lines: ' +
          lineNumbers.join(', '),
      };
    }

    // Build a diff preview for the user
    const lines = original.split('\n');
    const matchLine = original.slice(0, matchIndex).split('\n').length - 1;
    const diff = buildDiffPreview(lines, matchLine, oldStr, args.new_string);

    // Apply the edit
    const modified = args.replace_all
      ? original.split(oldStr).join(args.new_string)
      : original.slice(0, matchIndex) + args.new_string + original.slice(matchIndex + oldStr.length);

    // Save backup before writing
    const backupPath = saveBackup(target, original, cwd);

    atomicWriteFile(target, modified);
    recordUndo(ctx, {
      path: args.path,
      absolute_path: target,
      backup_path: backupPath,
      original_sha256: currentHash,
      new_sha256: sha256Text(modified),
      tool: 'edit_file',
    });

    return {
      ok: true,
      text:
        'File edited successfully. Backup saved to ' +
        backupPath +
        (args.replace_all ? '\nReplaced ' + count + ' occurrences.' : '') +
        '\n\nDiff:\n' +
        diff,
      diff,
      backupPath,
      current_hash: currentHash,
      new_hash: sha256Text(modified),
    };
  } catch (err) {
    return { ok: false, text: 'Error: ' + err.message };
  }
}

module.exports = { definition, execute };
