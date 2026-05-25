'use strict';

/**
 * instruction-delta.js — Detect CLAUDE.md edits mid-session and emit a
 * diff-only block instead of nuking the prompt cache.
 *
 * Without this, any CLAUDE.md write blows the static system-prompt cache
 * (A3) and forces a full re-prime on the next request. With this, the cache
 * stays warm and the model sees a short "instruction update" turn carrying
 * just the added / removed lines.
 *
 * Cache invalidation policy: skipped when delta is "small enough" (under
 * SMALL_DIFF_BYTES — fits comfortably as a delta block). Larger rewrites
 * still trigger a full cache invalidation, since the delta would dominate
 * the cached content anyway.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SMALL_DIFF_BYTES = 4096;

const _lastSeenByCwd = new Map();

function _hash(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
}

function _readClaudeMd(cwd) {
  const p = path.join(cwd, 'CLAUDE.md');
  try {
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function _diffLines(oldText, newText) {
  const oldLines = new Set(oldText.split('\n'));
  const newLines = new Set(newText.split('\n'));
  const added = [];
  const removed = [];
  for (const line of newText.split('\n')) {
    if (!oldLines.has(line)) added.push(line);
  }
  for (const line of oldText.split('\n')) {
    if (!newLines.has(line)) removed.push(line);
  }
  return { added, removed };
}

/**
 * snapshot(cwd) — record the current CLAUDE.md content as the baseline for
 * subsequent delta checks. Call this once per session at startup.
 */
function snapshot(cwd) {
  if (!cwd) return;
  const content = _readClaudeMd(cwd);
  _lastSeenByCwd.set(cwd, { content: content || '', hash: _hash(content || '') });
}

/**
 * detectChange(cwd) — compare current CLAUDE.md to the last snapshot. Returns:
 *   - null when unchanged
 *   - { kind: 'unsnapshotted' } when snapshot() wasn't called
 *   - { kind: 'small_diff', added: string[], removed: string[], deltaBlock: string }
 *   - { kind: 'large_rewrite', sizeBefore, sizeAfter } when the diff exceeds
 *     SMALL_DIFF_BYTES (caller should fall back to full cache invalidation)
 *
 * Also advances the snapshot so subsequent calls report only newer changes.
 */
function detectChange(cwd) {
  if (!cwd) return null;
  const prev = _lastSeenByCwd.get(cwd);
  if (!prev) return { kind: 'unsnapshotted' };

  const current = _readClaudeMd(cwd);
  const currentText = current || '';
  const currentHash = _hash(currentText);
  if (currentHash === prev.hash) return null;

  const { added, removed } = _diffLines(prev.content, currentText);
  const deltaSize = Buffer.byteLength(added.join('\n') + removed.join('\n'), 'utf8');

  if (deltaSize > SMALL_DIFF_BYTES) {
    _lastSeenByCwd.set(cwd, { content: currentText, hash: currentHash });
    return {
      kind: 'large_rewrite',
      sizeBefore: prev.content.length,
      sizeAfter: currentText.length,
    };
  }

  const parts = ['## Instruction memory update (CLAUDE.md edited mid-session)'];
  if (added.length) {
    parts.push('### Added\n' + added.map((l) => '+ ' + l).join('\n'));
  }
  if (removed.length) {
    parts.push('### Removed\n' + removed.map((l) => '- ' + l).join('\n'));
  }
  parts.push('Apply these to your operating instructions for the rest of the session.');

  _lastSeenByCwd.set(cwd, { content: currentText, hash: currentHash });
  return {
    kind: 'small_diff',
    added,
    removed,
    deltaBlock: parts.join('\n\n'),
  };
}

function reset() {
  _lastSeenByCwd.clear();
}

module.exports = {
  snapshot,
  detectChange,
  reset,
  SMALL_DIFF_BYTES,
};
