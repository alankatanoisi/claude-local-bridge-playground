'use strict';

/**
 * plan-proposals.js — Proposed-effect recorder for plan mode (P1-01).
 *
 * In plan mode the pipeline never executes a write. Instead of the old
 * one-line "Plan mode: would <action>" fabrication, write proposals are
 * materialized in memory using the SAME logic the real tools use, and
 * returned as a unified diff the user (or a later non-plan run with
 * apply_patch) can apply verbatim.
 *
 * The diff format matches this repo's apply_patch parser exactly:
 *   --- a/<path> / +++ b/<path> headers, one @@ hunk anchored on the common
 *   prefix/suffix, insert-only hunks use oldStart = line-before + 1.
 *
 * Non-file effects (shell, worktree, recovery, orchestration) still get the
 * honest one-line description — there is no meaningful diff for them.
 */

const fs = require('fs');
const safety = require('./safety');
const { materializeEdit } = require('./tools/edit-file');

const DIFF_CONTEXT_LINES = 3;
const MAX_PROPOSAL_CHARS = 20000;

/** Split into lines, dropping the phantom empty line from a trailing \n. */
function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

/**
 * Build a single-hunk unified diff between two text bodies. Returns null when
 * the texts are identical. The hunk is validated-by-construction against
 * apply_patch's parser (counts always match the body).
 */
function buildUnifiedDiff(originalText, modifiedText, filePath) {
  const oldLines = splitLines(originalText);
  const newLines = splitLines(modifiedText);

  let pre = 0;
  while (pre < oldLines.length && pre < newLines.length && oldLines[pre] === newLines[pre]) pre++;

  let suf = 0;
  while (
    suf < oldLines.length - pre &&
    suf < newLines.length - pre &&
    oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]
  ) {
    suf++;
  }

  const removed = oldLines.slice(pre, oldLines.length - suf);
  const added = newLines.slice(pre, newLines.length - suf);
  if (removed.length === 0 && added.length === 0) return null;

  const ctxBefore = Math.min(DIFF_CONTEXT_LINES, pre);
  const ctxAfter = Math.min(DIFF_CONTEXT_LINES, suf);

  const oldCount = ctxBefore + removed.length + ctxAfter;
  const newCount = ctxBefore + added.length + ctxAfter;
  // Insert-only hunk: apply_patch inserts BEFORE line oldStart, so the anchor
  // is the line after the common prefix (pre + 1). With context the anchor is
  // the first context line.
  const oldStart = oldCount === 0 ? pre + 1 : pre - ctxBefore + 1;
  const newStart = oldStart;

  const out = [];
  out.push('--- a/' + filePath);
  out.push('+++ b/' + filePath);
  out.push('@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@');
  for (let i = pre - ctxBefore; i < pre; i++) out.push(' ' + oldLines[i]);
  for (const line of removed) out.push('-' + line);
  for (const line of added) out.push('+' + line);
  for (let i = oldLines.length - suf; i < oldLines.length - suf + ctxAfter; i++) out.push(' ' + oldLines[i]);
  return out.join('\n');
}

function readOriginal(ctx, relPath) {
  const confined = safety.confinePath(ctx, relPath);
  if (!confined) return { ok: false, error: 'Path escapes working directory: ' + relPath };
  if (!fs.existsSync(confined)) return { ok: true, exists: false, text: '' };
  try {
    return { ok: true, exists: true, text: fs.readFileSync(confined, 'utf8') };
  } catch (err) {
    return { ok: false, error: 'Cannot read ' + relPath + ': ' + err.message };
  }
}

function clampProposal(text) {
  if (text.length <= MAX_PROPOSAL_CHARS) return text;
  return text.slice(0, MAX_PROPOSAL_CHARS) + '\n… (proposal truncated at ' + MAX_PROPOSAL_CHARS + ' chars)';
}

/**
 * Build a proposed-effect result for a plan-mode write. Returns:
 *   { kind: 'diff'|'new_file'|'described'|'invalid', text, diff? }
 *
 * 'invalid' means the proposed edit could not even be materialized against the
 * real file (e.g. old_string not found) — surfacing that in plan mode is the
 * whole point: the model learns its plan was wrong *before* anyone executes it.
 */
function buildPlanProposal(toolName, args, ctx, fallbackAction) {
  if (toolName === 'edit_file' && args && args.path) {
    const original = readOriginal(ctx, args.path);
    if (!original.ok) return { kind: 'invalid', text: 'Plan mode: proposal invalid — ' + original.error };
    if (!original.exists) {
      return { kind: 'invalid', text: 'Plan mode: proposal invalid — file does not exist: ' + args.path };
    }
    const materialized = materializeEdit(original.text, args);
    if (!materialized.ok) {
      return { kind: 'invalid', text: 'Plan mode: proposal invalid — ' + materialized.error };
    }
    const diff = buildUnifiedDiff(original.text, materialized.modified, args.path);
    if (!diff) return { kind: 'described', text: 'Plan mode: proposed edit is a no-op (file already matches).' };
    return {
      kind: 'diff',
      diff,
      text: clampProposal('Plan mode: proposed edit recorded (NOT applied). Unified diff:\n\n' + diff),
    };
  }

  if (toolName === 'write_file' && args && args.path && typeof args.content === 'string') {
    const original = readOriginal(ctx, args.path);
    if (!original.ok) return { kind: 'invalid', text: 'Plan mode: proposal invalid — ' + original.error };
    if (!original.exists) {
      return {
        kind: 'new_file',
        text: clampProposal(
          'Plan mode: proposed new file recorded (NOT created): ' +
            args.path +
            ' (' +
            Buffer.byteLength(args.content, 'utf8') +
            ' bytes)\n\n' +
            args.content,
        ),
      };
    }
    const diff = buildUnifiedDiff(original.text, args.content, args.path);
    if (!diff) return { kind: 'described', text: 'Plan mode: proposed write is a no-op (file already matches).' };
    return {
      kind: 'diff',
      diff,
      text: clampProposal('Plan mode: proposed overwrite recorded (NOT applied). Unified diff:\n\n' + diff),
    };
  }

  if (toolName === 'apply_patch' && args && typeof args.patch_text === 'string') {
    // The patch already IS the proposed diff; echo it as the recorded proposal.
    return {
      kind: 'diff',
      diff: args.patch_text,
      text: clampProposal('Plan mode: proposed patch recorded (NOT applied):\n\n' + args.patch_text),
    };
  }

  return { kind: 'described', text: 'Plan mode: would ' + fallbackAction };
}

module.exports = { buildPlanProposal, buildUnifiedDiff };
