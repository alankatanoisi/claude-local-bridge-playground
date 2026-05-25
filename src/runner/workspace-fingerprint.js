'use strict';

/**
 * workspace-fingerprint.js — Stable per-session signature for the workspace.
 *
 * Composed from cheap signals so it can be computed in <50 ms on a typical
 * repo:
 *   - git HEAD sha (current commit)
 *   - sha1(git status --porcelain) (uncommitted changes)
 *   - sha1(CLAUDE.md content) when present
 *
 * The fingerprint stays stable until any of those signals change. Persisted
 * to .bridge-runner/workspace.fingerprint so a fresh process can detect
 * "workspace unchanged since the last session" and trust any cross-session
 * cache layer that wires through here. The in-memory caches added in this
 * PR (file-cache, search-cache, realpath-cache) don't persist across
 * processes, but the seam is in place for future persistence work.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const FINGERPRINT_VERSION = 1;
const STATE_DIR_NAME = '.bridge-runner';
const FINGERPRINT_FILE = 'workspace.fingerprint';

function _sha1(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

function _gitHead(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function _gitDirtyHash(cwd) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return _sha1(out).slice(0, 16);
  } catch {
    return null;
  }
}

function _claudeMdHash(cwd) {
  const p = path.join(cwd, 'CLAUDE.md');
  try {
    if (!fs.existsSync(p)) return null;
    return _sha1(fs.readFileSync(p, 'utf8')).slice(0, 16);
  } catch {
    return null;
  }
}

function compute(cwd) {
  if (!cwd) return { v: FINGERPRINT_VERSION, fingerprint: null, sources: {} };
  const sources = {
    gitHead: _gitHead(cwd),
    dirtyHash: _gitDirtyHash(cwd),
    claudeMdHash: _claudeMdHash(cwd),
    cwdRealpath: (() => {
      try {
        return fs.realpathSync(cwd);
      } catch {
        return cwd;
      }
    })(),
  };
  const buf = JSON.stringify(sources);
  return { v: FINGERPRINT_VERSION, fingerprint: _sha1(buf).slice(0, 24), sources };
}

function stateDirFor(cwd) {
  return path.join(cwd, STATE_DIR_NAME);
}

function fingerprintPath(cwd) {
  return path.join(stateDirFor(cwd), FINGERPRINT_FILE);
}

function read(cwd) {
  const fp = fingerprintPath(cwd);
  try {
    if (!fs.existsSync(fp)) return null;
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (parsed.v !== FINGERPRINT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(cwd, value) {
  const dir = stateDirFor(cwd);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fingerprintPath(cwd), JSON.stringify(value, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

function changed(prev, next) {
  if (!prev || !next) return true;
  if (prev.v !== next.v) return true;
  return prev.fingerprint !== next.fingerprint;
}

module.exports = {
  FINGERPRINT_VERSION,
  compute,
  read,
  write,
  changed,
  fingerprintPath,
};
