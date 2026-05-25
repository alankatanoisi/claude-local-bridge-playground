'use strict';

/**
 * repo-map.js — One-pass automatic repo summary for session-start context.
 *
 * Cheap to compute (<100ms typical), capped output (~2 KB). Lives inside
 * E1's session-stable repo-context block so the cost is paid once per run
 * and the result rides the fourth Anthropic prompt-cache breakpoint.
 *
 * Captures:
 *   - top-level files + directories (one level deep)
 *   - file counts by extension across cwd (bounded scan)
 *   - entrypoint signals: package.json, pyproject.toml, Cargo.toml,
 *     go.mod, Makefile, CMakeLists.txt — name + first ~300 chars
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2048;
const MAX_TOP_LEVEL_ENTRIES = 40;
const MAX_SCAN_FILES = 2000;
const ENTRYPOINT_NAMES = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Makefile',
  'CMakeLists.txt',
  'setup.py',
  'requirements.txt',
  'pom.xml',
  'build.gradle',
];
const SKIP_DIRS = new Set([
  '.git',
  '.bridge-runner',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  'target',
  '__pycache__',
  '.venv',
  'venv',
]);

function _topLevel(cwd) {
  let entries;
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return null;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) dirs.push(e.name + '/');
    else if (e.isFile()) files.push(e.name);
  }
  const all = [...dirs, ...files].slice(0, MAX_TOP_LEVEL_ENTRIES);
  return all;
}

function _extCounts(cwd) {
  const counts = new Map();
  let scanned = 0;
  function walk(dir, depth) {
    if (scanned >= MAX_SCAN_FILES) return;
    if (depth > 4) return;
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of items) {
      if (scanned >= MAX_SCAN_FILES) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        scanned++;
        const ext = path.extname(e.name).toLowerCase() || '(none)';
        counts.set(ext, (counts.get(ext) || 0) + 1);
      }
    }
  }
  walk(cwd, 0);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return { counts: sorted, scanned };
}

function _entrypoints(cwd) {
  const found = [];
  for (const name of ENTRYPOINT_NAMES) {
    const p = path.join(cwd, name);
    try {
      if (!fs.existsSync(p)) continue;
      const content = fs.readFileSync(p, 'utf8');
      const snippet = content.slice(0, 300).trim();
      found.push({ name, snippet });
    } catch {
      // skip
    }
  }
  return found;
}

function buildRepoMap(cwd) {
  if (!cwd) return null;
  let exists = false;
  try {
    exists = fs.statSync(cwd).isDirectory();
  } catch {
    return null;
  }
  if (!exists) return null;

  const top = _topLevel(cwd);
  const ext = _extCounts(cwd);
  const eps = _entrypoints(cwd);

  if ((!top || top.length === 0) && eps.length === 0 && ext.counts.length === 0) return null;

  const parts = ['### Repository map'];
  if (top && top.length) parts.push('Top-level: ' + top.join(', '));
  if (ext.counts.length) {
    parts.push(
      'File mix' +
        (ext.scanned >= MAX_SCAN_FILES ? ' (sampled)' : '') +
        ': ' +
        ext.counts.map(([e, n]) => e + '=' + n).join(', '),
    );
  }
  for (const ep of eps) {
    parts.push('Entrypoint `' + ep.name + '`:\n' + ep.snippet);
  }
  let out = parts.join('\n\n');
  if (out.length > MAX_BYTES) {
    out = out.slice(0, MAX_BYTES) + '\n... [repo-map truncated to ' + MAX_BYTES + ' bytes]';
  }
  return out;
}

module.exports = {
  buildRepoMap,
  MAX_BYTES,
  ENTRYPOINT_NAMES,
  SKIP_DIRS,
};
