'use strict';

/**
 * private-fs.js — Explicit private modes for runner-owned artifacts (P0-12).
 *
 * Session state, ledgers, manifests, transcripts, and other runner telemetry
 * must not rely on the process umask. Directories are 0700; files are 0600.
 *
 * Do NOT use these helpers for user project files written by edit/write tools —
 * those should keep normal umask behavior so the user's project stays as they
 * expect.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * Ensure a directory exists with mode 0700. Tightens an existing looser dir.
 * Recursive parents are also created at 0700 when missing.
 *
 * @param {string} dir
 * @returns {string} absolute dir path
 */
function ensurePrivateDir(dir) {
  if (!dir) throw new Error('ensurePrivateDir: dir is required');
  const absolute = path.resolve(dir);
  if (!fs.existsSync(absolute)) {
    fs.mkdirSync(absolute, { recursive: true, mode: DIR_MODE });
  }
  // mkdir recursive may inherit umask on some parents; tighten the leaf always.
  try {
    fs.chmodSync(absolute, DIR_MODE);
  } catch {
    // Non-POSIX filesystems (or Windows) may ignore chmod; still best-effort.
  }
  // Walk newly created parents under the common home/project roots and tighten
  // only when we own them and they are not the filesystem root.
  _tightenParentsIfNeeded(absolute);
  return absolute;
}

function _tightenParentsIfNeeded(absolute) {
  const home = os.homedir();
  let current = path.dirname(absolute);
  // Cap the walk so we never chmod outside runner-ish trees.
  for (let i = 0; i < 8; i++) {
    if (!current || current === path.parse(current).root) break;
    const base = path.basename(current);
    const underHomeBridge = current.startsWith(path.join(home, '.bridge-runner'));
    const isBridgeRunnerLeaf = base === '.bridge-runner';
    if (!underHomeBridge && !isBridgeRunnerLeaf) break;
    try {
      if (fs.existsSync(current)) fs.chmodSync(current, DIR_MODE);
    } catch {
      // best-effort
    }
    if (isBridgeRunnerLeaf) break;
    current = path.dirname(current);
  }
}

/**
 * Write a file with mode 0600. Parent dirs are ensured private first.
 *
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {string} [encoding='utf8']
 */
function privateWriteFileSync(filePath, data, encoding = 'utf8') {
  if (!filePath) throw new Error('privateWriteFileSync: filePath is required');
  ensurePrivateDir(path.dirname(filePath));
  const opts = { mode: FILE_MODE };
  if (typeof data === 'string') {
    fs.writeFileSync(filePath, data, { encoding, ...opts });
  } else {
    fs.writeFileSync(filePath, data, opts);
  }
  try {
    fs.chmodSync(filePath, FILE_MODE);
  } catch {
    // best-effort on non-POSIX
  }
}

/**
 * Append to a file with mode 0600. Creates the file privately if missing.
 *
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {string} [encoding='utf8']
 */
function privateAppendFileSync(filePath, data, encoding = 'utf8') {
  if (!filePath) throw new Error('privateAppendFileSync: filePath is required');
  ensurePrivateDir(path.dirname(filePath));
  const existed = fs.existsSync(filePath);
  if (typeof data === 'string') {
    fs.appendFileSync(filePath, data, { encoding, mode: FILE_MODE });
  } else {
    fs.appendFileSync(filePath, data, { mode: FILE_MODE });
  }
  if (!existed) {
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
  } else {
    // Existing files may have been created under a looser umask — tighten.
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
  }
}

/**
 * Atomic JSON/text write: temp file at 0600, rename, then chmod final.
 * Rename keeps the temp mode on most Unix systems; chmod after is belt+suspenders.
 *
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {string} [encoding='utf8']
 */
function privateAtomicWriteSync(filePath, data, encoding = 'utf8') {
  if (!filePath) throw new Error('privateAtomicWriteSync: filePath is required');
  ensurePrivateDir(path.dirname(filePath));
  const tmp = filePath + '.tmp.' + process.pid;
  try {
    if (typeof data === 'string') {
      fs.writeFileSync(tmp, data, { encoding, mode: FILE_MODE });
    } else {
      fs.writeFileSync(tmp, data, { mode: FILE_MODE });
    }
    try {
      fs.chmodSync(tmp, FILE_MODE);
    } catch {
      // best-effort
    }
    fs.renameSync(tmp, filePath);
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

/**
 * Open a file for append with 0600 when creating. Returns an fd.
 *
 * @param {string} filePath
 * @returns {number} file descriptor
 */
function openPrivateAppend(filePath) {
  if (!filePath) throw new Error('openPrivateAppend: filePath is required');
  ensurePrivateDir(path.dirname(filePath));
  const fd = fs.openSync(filePath, 'a', FILE_MODE);
  try {
    fs.fchmodSync(fd, FILE_MODE);
  } catch {
    try {
      fs.chmodSync(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
  }
  return fd;
}

function modeBits(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

module.exports = {
  DIR_MODE,
  FILE_MODE,
  ensurePrivateDir,
  privateWriteFileSync,
  privateAppendFileSync,
  privateAtomicWriteSync,
  openPrivateAppend,
  modeBits,
};
