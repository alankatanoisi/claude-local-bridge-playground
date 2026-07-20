'use strict';

/**
 * apply_patch tool — Apply a unified diff patch to one file (P0-06 repaired).
 *
 * Safety contract:
 *   - No shell. Filenames and patch text never reach a shell or execSync string.
 *   - Every hunk is validated against the current file before any write.
 *   - One atomic write via file-write-utils; hash-aware backup + undo log.
 *   - On write failure after backup, restore the backup (all-or-nothing).
 *
 * Still hidden by default; expose with --tools apply_patch (or --allowed-tools).
 */

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { atomicWriteFile, recordUndo, saveBackup, sha256Text } = require('./file-write-utils');

function definition() {
  return {
    name: 'apply_patch',
    description:
      'Apply a unified diff patch to an existing file. Every hunk is validated ' +
      'before writing. A backup is saved and the write is atomic. Prefer edit_file ' +
      'for simple replacements. Hidden unless named in --tools.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file to patch inside the project',
        },
        patch_text: {
          type: 'string',
          description: 'Unified diff content (@@ hunk headers with + / - / context lines)',
        },
        expected_sha256: {
          type: 'string',
          description: 'Optional SHA-256 of the current file. If it differs, the patch is refused.',
        },
      },
      required: ['path', 'patch_text'],
    },
  };
}

/**
 * Parse unified-diff hunks from patch text.
 * Returns { ok, hunks } or { ok: false, error }.
 */
function parseUnifiedHunks(patchText) {
  if (typeof patchText !== 'string' || !patchText.trim()) {
    return { ok: false, error: 'patch_text must be a non-empty string' };
  }

  const lines = patchText.replace(/\r\n/g, '\n').split('\n');
  const hunks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Skip file headers and noise; only @@ hunks matter for single-file apply.
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ')) {
      i++;
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!hunkMatch) {
      i++;
      continue;
    }

    const oldStart = parseInt(hunkMatch[1], 10); // 1-based
    const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
    const newStart = parseInt(hunkMatch[3], 10);
    const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
    i++;

    const hunkLines = [];
    let oldSeen = 0;
    let newSeen = 0;

    while (i < lines.length) {
      const p = lines[i];
      if (p.startsWith('@@')) break;
      if (p.startsWith('---') || p.startsWith('+++') || p.startsWith('diff ')) break;

      if (p.startsWith('\\')) {
        // "\ No newline at end of file" — informational; ignore for content.
        i++;
        continue;
      }

      if (p.startsWith(' ') || p.startsWith('+') || p.startsWith('-')) {
        const tag = p[0];
        const body = p.slice(1);
        hunkLines.push({ tag, body });
        if (tag === ' ' || tag === '-') oldSeen++;
        if (tag === ' ' || tag === '+') newSeen++;
        i++;
        continue;
      }

      if (p === '') {
        // Blank line without a prefix is ambiguous; treat as end of hunk body.
        break;
      }

      return {
        ok: false,
        error: 'Invalid hunk line (expected space/+/- prefix): ' + JSON.stringify(p.slice(0, 80)),
      };
    }

    if (oldCount !== oldSeen) {
      return {
        ok: false,
        error:
          'Hunk old-count mismatch at @@ -' +
          oldStart +
          ': header says ' +
          oldCount +
          ' but body has ' +
          oldSeen +
          ' old/context lines',
      };
    }
    if (newCount !== newSeen) {
      return {
        ok: false,
        error:
          'Hunk new-count mismatch at @@ +' +
          newStart +
          ': header says ' +
          newCount +
          ' but body has ' +
          newSeen +
          ' new/context lines',
      };
    }

    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }

  if (hunks.length === 0) {
    return { ok: false, error: 'No @@ hunk headers found. Provide a unified diff.' };
  }

  return { ok: true, hunks };
}

/**
 * Validate that a hunk's old/context lines match the current file, then return
 * the replacement lines for that span. Does not mutate fileLines.
 */
function validateAndMaterializeHunk(fileLines, hunk) {
  const startIdx = hunk.oldStart - 1; // 0-based
  if (startIdx < 0) {
    return { ok: false, error: 'Hunk oldStart must be >= 1' };
  }

  // oldCount 0 means insert-only at startIdx (before that line, or append).
  if (hunk.oldCount === 0) {
    if (startIdx > fileLines.length) {
      return {
        ok: false,
        error: 'Insert hunk points past end of file (oldStart=' + hunk.oldStart + ')',
      };
    }
  } else if (startIdx + hunk.oldCount > fileLines.length) {
    return {
      ok: false,
      error:
        'Hunk at line ' +
        hunk.oldStart +
        ' extends past end of file (need ' +
        hunk.oldCount +
        ' lines, file has ' +
        fileLines.length +
        ')',
    };
  }

  let filePos = startIdx;
  const replacement = [];

  for (const { tag, body } of hunk.lines) {
    if (tag === ' ' || tag === '-') {
      const actual = fileLines[filePos];
      if (actual !== body) {
        return {
          ok: false,
          error:
            'Hunk context mismatch at file line ' +
            (filePos + 1) +
            ':\n  expected: ' +
            JSON.stringify(body) +
            '\n  actual:   ' +
            JSON.stringify(actual),
        };
      }
      if (tag === ' ') replacement.push(body);
      filePos++;
    } else if (tag === '+') {
      replacement.push(body);
    }
  }

  return {
    ok: true,
    startIdx,
    endIdx: startIdx + hunk.oldCount, // exclusive
    replacement,
  };
}

/**
 * Apply all validated hunks in memory. Hunks are applied from last to first so
 * earlier line numbers stay stable.
 */
function applyHunksInMemory(originalText, hunks) {
  // Preserve whether the original ended with a newline.
  const endsWithNewline = originalText.endsWith('\n');
  let fileLines = originalText.split('\n');
  // split() on "a\n" → ["a", ""]; on "a" → ["a"]. Trailing empty from final \n
  // is the conventional representation; keep it for indexing consistency with
  // diff tools that count lines without the phantom last empty when no newline.
  if (endsWithNewline && fileLines.length > 0 && fileLines[fileLines.length - 1] === '') {
    fileLines = fileLines.slice(0, -1);
  }

  const validated = [];
  for (const hunk of hunks) {
    const result = validateAndMaterializeHunk(fileLines, hunk);
    if (!result.ok) return result;
    validated.push(result);
  }

  // Sort by startIdx descending so replacements do not shift later indices.
  validated.sort((a, b) => b.startIdx - a.startIdx);

  let lines = fileLines.slice();
  for (const v of validated) {
    lines = [...lines.slice(0, v.startIdx), ...v.replacement, ...lines.slice(v.endIdx)];
  }

  let out = lines.join('\n');
  if (endsWithNewline || originalText === '') out += '\n';
  return { ok: true, text: out, hunkCount: hunks.length };
}

function restoreFromBackup(target, backupPath) {
  try {
    const buf = fs.readFileSync(backupPath);
    atomicWriteFile(target, buf.toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

function execute(args, ctx) {
  const confined = safety.confinePath(ctx, args && args.path);
  if (!confined) {
    return { ok: false, text: 'Path escapes working directory: ' + (args && args.path) };
  }
  const target = confined;
  const cwd = ctx.cwdRealpath || ctx.cwd || process.cwd();

  if (typeof (args && args.patch_text) !== 'string') {
    return { ok: false, text: 'Missing required patch_text argument for apply_patch.' };
  }

  if (!fs.existsSync(target)) {
    return { ok: false, text: 'File not found: ' + args.path };
  }

  let original;
  try {
    original = fs.readFileSync(target, 'utf8');
  } catch (err) {
    return { ok: false, text: 'Cannot read file: ' + err.message };
  }

  const originalHash = sha256Text(original);
  if (args.expected_sha256 && args.expected_sha256 !== originalHash) {
    return {
      ok: false,
      text:
        'File changed since expected_sha256 was computed. Re-read the file and retry. ' +
        'expected=' +
        args.expected_sha256.slice(0, 12) +
        '… actual=' +
        originalHash.slice(0, 12) +
        '…',
    };
  }

  const parsed = parseUnifiedHunks(args.patch_text);
  if (!parsed.ok) {
    return { ok: false, text: parsed.error };
  }

  const applied = applyHunksInMemory(original, parsed.hunks);
  if (!applied.ok) {
    return { ok: false, text: applied.error };
  }

  if (applied.text === original) {
    return { ok: true, text: 'Patch applied (no content change). Hunks: ' + applied.hunkCount };
  }

  let backupPath;
  try {
    backupPath = saveBackup(target, Buffer.from(original, 'utf8'), cwd);
  } catch (err) {
    return { ok: false, text: 'Cannot save backup: ' + err.message };
  }

  try {
    atomicWriteFile(target, applied.text);
  } catch (err) {
    const restored = restoreFromBackup(target, backupPath);
    return {
      ok: false,
      text:
        'Atomic write failed: ' +
        err.message +
        (restored ? ' Backup restored.' : ' CRITICAL: backup restore also failed at ' + backupPath),
    };
  }

  // Verify the on-disk result matches what we intended (detect silent truncation).
  let written;
  try {
    written = fs.readFileSync(target, 'utf8');
  } catch (err) {
    restoreFromBackup(target, backupPath);
    return { ok: false, text: 'Post-write read failed; restored backup. ' + err.message };
  }

  if (written !== applied.text) {
    restoreFromBackup(target, backupPath);
    return { ok: false, text: 'Post-write verification failed; restored backup.' };
  }

  const newHash = sha256Text(written);
  recordUndo(ctx, {
    path: args.path,
    absolute_path: target,
    tool: 'apply_patch',
    backup_path: backupPath,
    original_sha256: originalHash,
    new_sha256: newHash,
    created: false,
  });

  return {
    ok: true,
    text:
      'Patch applied (' +
      applied.hunkCount +
      ' hunk' +
      (applied.hunkCount === 1 ? '' : 's') +
      '). Backup: ' +
      path.relative(cwd, backupPath),
  };
}

module.exports = {
  definition,
  execute,
  // Exported for unit tests — not a public API.
  _parseUnifiedHunks: parseUnifiedHunks,
  _applyHunksInMemory: applyHunksInMemory,
  meta: { name: 'apply_patch', category: 'write', hidden: true },
};
