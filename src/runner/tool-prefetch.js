'use strict';

/**
 * tool-prefetch.js — Opt-in speculative read prefetch.
 *
 * After the model finishes a read, predict likely next reads based on
 * the path's neighbors and warm the shared file cache. Strictly read-only;
 * never executes tools that could mutate the workspace.
 *
 * Enabled by BRIDGE_RUNNER_PREFETCH=1 only. Disabled by default because
 * heuristic predictions have high variance and warming the cache for
 * unread files wastes RAM.
 *
 * The prefetch path goes through _file-cache.readCached() which already
 * enforces the per-entry byte cap and respects the LRU. Permission checks
 * are NOT bypassed: we filter prefetch candidates by the runner's normal
 * confinePath + denylist before reading.
 */

const fs = require('fs');
const path = require('path');
const safety = require('./safety');
const fileCache = require('./tools/_file-cache');

const MAX_PREFETCH_PER_CALL = 4;

const NEIGHBORS_BY_BASENAME = new Map([
  [
    'package.json',
    ['tsconfig.json', 'README.md', '.eslintrc.cjs', '.eslintrc.json', '.prettierrc', 'package-lock.json'],
  ],
  ['tsconfig.json', ['package.json', 'tsconfig.build.json']],
  ['pyproject.toml', ['README.md', 'setup.cfg', 'requirements.txt']],
  ['Cargo.toml', ['README.md', 'Cargo.lock']],
  ['Makefile', ['README.md']],
  ['CLAUDE.md', []],
  ['README.md', []],
]);

function isPrefetchEnabled() {
  return process.env.BRIDGE_RUNNER_PREFETCH === '1';
}

function _neighborsFor(targetPath, cwd) {
  const base = path.basename(targetPath);
  const candidates = [];
  const direct = NEIGHBORS_BY_BASENAME.get(base);
  if (direct) {
    for (const name of direct) candidates.push(path.join(cwd, name));
  }
  // For source files, suggest test sibling and adjacent .d.ts
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  if (ext === '.js' || ext === '.ts' || ext === '.mjs' || ext === '.cjs') {
    const dir = path.dirname(targetPath);
    candidates.push(path.join(dir, stem + '.test' + ext));
    candidates.push(path.join(dir, stem + '.spec' + ext));
    candidates.push(path.join(dir, stem + '.d.ts'));
  }
  return candidates;
}

/**
 * predictCandidates(targetPath, cwd) — return up to MAX_PREFETCH_PER_CALL
 * paths most likely to be read next. Pure function; no IO except the
 * existsSync filter inside warm().
 */
function predictCandidates(targetPath, cwd) {
  if (!targetPath || !cwd) return [];
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(cwd, targetPath);
  const seen = new Set();
  const out = [];
  for (const c of _neighborsFor(abs, cwd)) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= MAX_PREFETCH_PER_CALL) break;
  }
  return out;
}

/**
 * warm(targetPath, ctx) — predict + warm the file cache for likely-next
 * reads. Returns a list of paths actually warmed (existed + passed
 * confinement). Strict no-write; refuses absolute paths outside cwd via
 * safety.confinePath.
 */
function warm(targetPath, ctx) {
  if (!isPrefetchEnabled()) return [];
  if (!ctx || !ctx.cwd) return [];
  const candidates = predictCandidates(targetPath, ctx.cwd);
  const warmed = [];
  for (const c of candidates) {
    try {
      if (!fs.existsSync(c)) continue;
      const rel = path.relative(ctx.cwd, c);
      const confined = safety.confinePath(ctx, rel);
      if (!confined) continue;
      if (safety.isPathBlockedByDenyMatrix(confined)) continue;
      const got = fileCache.readCached(confined);
      if (got) warmed.push(confined);
    } catch {
      // best-effort
    }
  }
  return warmed;
}

module.exports = {
  predictCandidates,
  warm,
  isPrefetchEnabled,
  MAX_PREFETCH_PER_CALL,
};
