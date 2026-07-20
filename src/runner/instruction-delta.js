'use strict';

/**
 * instruction-delta.js — Detect instruction-doc edits mid-session and emit a
 * diff-only block instead of nuking the prompt cache.
 *
 * Without this, any instruction-doc write blows the static system-prompt cache
 * (A3) and forces a full re-prime on the next request. With this, the cache
 * stays warm and the model sees a short "instruction update" turn carrying
 * just the added / removed lines.
 *
 * P1-13: the watched sources are DERIVED FROM THE EFFECTIVE CONTEXT POLICY.
 * Under bare/minimal context (where CLAUDE.md/AGENTS.md were never injected)
 * nothing is watched — a file the operator excluded from the prompt must not
 * be able to alter the running conversation mid-session. Every emitted delta
 * names its source file and content hash so the change is attributable.
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

// Legacy default: watch CLAUDE.md only (pre-P1-13 behavior, kept so existing
// direct callers/tests keep working). run.js always passes an explicit list.
const DEFAULT_WATCHED_SOURCES = Object.freeze(['CLAUDE.md']);

// Project-level instruction docs that can be part of the injected context.
// Must stay in sync with MEMORY_FILES in memory/instruction-memory.js.
const INSTRUCTION_DOC_SOURCES = Object.freeze(['AGENTS.md', 'CLAUDE.md', 'RUNNER.md']);

const _stateByCwd = new Map();

function _hash(content) {
  return crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
}

function _readSource(cwd, source) {
  const p = path.join(cwd, source);
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
 * watchedSourcesForPolicy(contextPolicy) — the single mapping from context
 * policy to watched instruction files. Only sources the policy actually
 * injects into the prompt may be watched:
 *   - includeInstructionDocs      → all project instruction docs
 *   - includeClaudeMdInRepoContext → CLAUDE.md only (repo-context block)
 *   - bare / minimal (neither)     → nothing; mid-session edits are ignored
 */
function watchedSourcesForPolicy(contextPolicy = {}) {
  if (contextPolicy.includeInstructionDocs) return [...INSTRUCTION_DOC_SOURCES];
  if (contextPolicy.includeClaudeMdInRepoContext) return ['CLAUDE.md'];
  return [];
}

/**
 * snapshot(cwd, sources) — record current content of each watched source as
 * the baseline for delta checks. Call once per session at startup. An empty
 * source list is valid and means "watch nothing" (bare/minimal context).
 */
function snapshot(cwd, sources = DEFAULT_WATCHED_SOURCES) {
  if (!cwd) return;
  const baseline = new Map();
  for (const source of sources) {
    const content = _readSource(cwd, source) || '';
    baseline.set(source, { content, hash: _hash(content) });
  }
  _stateByCwd.set(cwd, { sources: [...sources], baseline });
}

/**
 * detectChange(cwd) — compare each watched source to its snapshot. Returns:
 *   - null when nothing watched changed (or nothing is watched)
 *   - { kind: 'unsnapshotted' } when snapshot() wasn't called
 *   - { kind: 'small_diff', added, removed, deltaBlock, sources: [{ source, hash }] }
 *   - { kind: 'large_rewrite', sizeBefore, sizeAfter, sources: [{ source, hash }] }
 *     when the combined diff exceeds SMALL_DIFF_BYTES (caller should fall back
 *     to full cache invalidation)
 *
 * Also advances the snapshot so subsequent calls report only newer changes.
 * Every result identifies the changed source files and their new hashes.
 */
function detectChange(cwd) {
  if (!cwd) return null;
  const state = _stateByCwd.get(cwd);
  if (!state) return { kind: 'unsnapshotted' };
  if (state.sources.length === 0) return null;

  const changed = [];
  let deltaSize = 0;
  let sizeBefore = 0;
  let sizeAfter = 0;

  for (const source of state.sources) {
    const prev = state.baseline.get(source) || { content: '', hash: _hash('') };
    const currentText = _readSource(cwd, source) || '';
    const currentHash = _hash(currentText);
    if (currentHash === prev.hash) continue;

    const { added, removed } = _diffLines(prev.content, currentText);
    deltaSize += Buffer.byteLength(added.join('\n') + removed.join('\n'), 'utf8');
    sizeBefore += prev.content.length;
    sizeAfter += currentText.length;
    changed.push({ source, hash: currentHash, added, removed });
    state.baseline.set(source, { content: currentText, hash: currentHash });
  }

  if (changed.length === 0) return null;

  const sources = changed.map(({ source, hash }) => ({ source, hash }));

  if (deltaSize > SMALL_DIFF_BYTES) {
    return { kind: 'large_rewrite', sizeBefore, sizeAfter, sources };
  }

  const allAdded = [];
  const allRemoved = [];
  const parts = [];
  for (const change of changed) {
    // Each section names its source + hash so the delta is attributable
    // (P1-13 acceptance: every delta identifies its source and hash).
    parts.push(
      '## Instruction memory update (' + change.source + ' edited mid-session; now ' + change.hash + ')',
    );
    if (change.added.length) {
      parts.push('### Added\n' + change.added.map((l) => '+ ' + l).join('\n'));
      allAdded.push(...change.added);
    }
    if (change.removed.length) {
      parts.push('### Removed\n' + change.removed.map((l) => '- ' + l).join('\n'));
      allRemoved.push(...change.removed);
    }
  }
  parts.push('Apply these to your operating instructions for the rest of the session.');

  return {
    kind: 'small_diff',
    added: allAdded,
    removed: allRemoved,
    deltaBlock: parts.join('\n\n'),
    sources,
  };
}

function reset() {
  _stateByCwd.clear();
}

module.exports = {
  snapshot,
  detectChange,
  watchedSourcesForPolicy,
  reset,
  SMALL_DIFF_BYTES,
  INSTRUCTION_DOC_SOURCES,
};
