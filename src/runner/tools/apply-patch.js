'use strict';

/**
 * apply_patch tool — Apply a unified diff patch to a file.
 *
 * Tries `patch` command first, falls back to a basic inline implementation
 * that handles simple @@ hunk headers with additions (+) and deletions (-).
 *
 * A backup is saved before any modification.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function definition() {
  return {
    name: 'apply_patch',
    description:
      'Apply a unified diff patch to a file. A backup is saved before modifying. ' +
      'Handles standard diff hunks (lines with + / - / context).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file to patch inside the project',
        },
        patch_text: {
          type: 'string',
          description: 'Unified diff content to apply',
        },
      },
      required: ['path', 'patch_text'],
    },
  };
}

function saveBackup(filePath) {
  const backupsDir = path.join(path.dirname(filePath), '..', '.bridge-runner', 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const backupPath = path.join(backupsDir, path.basename(filePath) + '.bak');
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

// Try system patch command first — most reliable for standard diff format
function trySystemPatch(target, patchText) {
  try {
    const tmpPatch = target + '.patch.tmp';
    fs.writeFileSync(tmpPatch, patchText, 'utf8');
    execSync('patch -u ' + JSON.stringify(target) + ' ' + JSON.stringify(tmpPatch), {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    fs.unlinkSync(tmpPatch);
    return true;
  } catch {
    try {
      fs.unlinkSync(target + '.patch.tmp');
    } catch {
      /* ok */
    }
    return false;
  }
}

// Basic inline patch: handles simple @@ -L,C +L,C @@ hunks
function applyBasicPatch(lines, patchText) {
  const patchLines = patchText.split('\n');
  let i = 0;
  const result = [...lines];

  while (i < patchLines.length) {
    const line = patchLines[i];
    // Look for an @@ hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10) - 1; // 0-indexed
      const newStart = parseInt(hunkMatch[3], 10) - 1;
      i++;

      let oldPos = oldStart;
      let newPos = newStart;
      const newResult = [...result.slice(0, newPos)];

      while (
        i < patchLines.length &&
        (patchLines[i].startsWith(' ') || patchLines[i].startsWith('+') || patchLines[i].startsWith('-'))
      ) {
        const pLine = patchLines[i];
        if (pLine.startsWith(' ')) {
          // Context line — present in both
          newResult[newPos] = result[oldPos];
          oldPos++;
          newPos++;
        } else if (pLine.startsWith('-')) {
          // Removed line — skip
          oldPos++;
        } else if (pLine.startsWith('+')) {
          // Added line — insert
          newResult[newPos] = pLine.slice(1);
          oldPos++; // advance both since we're aligning
          newPos++;
        }
        i++;
      }
      // Append remaining lines from original
      newResult.push(...result.slice(oldPos));
      return newResult;
    }
    i++;
  }

  return null; // no hunks found
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const target = path.resolve(cwd, args.path);
  const patchText = args.patch_text;

  if (!fs.existsSync(target)) {
    return { ok: false, text: 'File not found: ' + args.path };
  }

  // Save backup
  let backupPath;
  try {
    backupPath = saveBackup(target);
  } catch (err) {
    return { ok: false, text: 'Cannot save backup: ' + err.message };
  }

  // Try system patch first
  if (trySystemPatch(target, patchText)) {
    return { ok: true, text: 'Patch applied (system patch). Backup: ' + backupPath };
  }

  // Fall back to basic inline patcher
  const original = fs.readFileSync(target, 'utf8');
  const lines = original.split('\n');
  const patched = applyBasicPatch(lines, patchText);

  if (!patched) {
    return { ok: false, text: 'Could not parse patch. Make sure it is in unified diff format with @@ hunk headers.' };
  }

  const resultLines = patched.join('\n');
  fs.writeFileSync(target, resultLines, 'utf8');

  return { ok: true, text: 'Patch applied (basic patcher). Backup: ' + backupPath };
}

module.exports = { definition, execute };
