'use strict';

// These helpers keep the write tools boring and predictable: write to a
// temporary file first, flush it, then rename it over the target in one step.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function atomicWriteFile(filePath, content) {
  ensureParentDir(filePath);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, '.' + base + '.tmp-' + process.pid + '-' + Date.now());

  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, filePath);

  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is best-effort on macOS and can fail on some filesystems.
  }
}

function saveBackup(filePath, contentBuffer, cwd) {
  const backupsRoot = cwd || path.dirname(filePath);
  const backupsDir = path.join(backupsRoot, '.bridge-runner', 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const backupPath = path.join(backupsDir, path.basename(filePath) + '-' + Date.now() + '.bak');
  fs.writeFileSync(backupPath, contentBuffer);
  return backupPath;
}

function recordUndo(ctx, entry) {
  if (!ctx) return;
  if (!ctx.undoLog) ctx.undoLog = [];
  ctx.undoLog.push({
    tool_use_id: ctx.toolUseId || null,
    timestamp: new Date().toISOString(),
    ...entry,
  });
}

module.exports = { atomicWriteFile, recordUndo, saveBackup, sha256Text };
