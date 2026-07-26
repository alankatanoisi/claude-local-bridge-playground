'use strict';

const fs = require('fs');
// A7: the archive index is runner-owned telemetry, not a user project file, so
// it must not inherit the process umask (which produced world-readable 0644
// catalogs). private-fs is the same 0700/0600 helper transcript, session,
// ledger, and trust files already go through.
const { ensurePrivateDir, privateWriteFileSync, privateAppendFileSync } = require('../private-fs');
const { catalogJsonlPath, catalogLatestPath, sessionsIndexPath, indexDir } = require('./paths');

function ensureIndexDir() {
  ensurePrivateDir(indexDir());
}

function readCatalogJsonl() {
  const p = catalogJsonlPath();
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function hasRunId(runId) {
  return readCatalogJsonl().some((r) => r.runId === runId);
}

function appendCatalogEntry(entry) {
  ensureIndexDir();
  privateAppendFileSync(catalogJsonlPath(), JSON.stringify(entry) + '\n');
}

function rebuildCatalogLatest() {
  const rows = readCatalogJsonl();
  rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  ensureIndexDir();
  privateWriteFileSync(catalogLatestPath(), JSON.stringify(rows, null, 2) + '\n');
  return rows;
}

function readSessionsIndex() {
  const p = sessionsIndexPath();
  if (!fs.existsSync(p)) return { sessions: {} };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { sessions: {} };
  }
}

function updateSessionsIndex(sessionId, runId, meta = {}) {
  if (!sessionId) return;
  const idx = readSessionsIndex();
  if (!idx.sessions) idx.sessions = {};
  if (!idx.sessions[sessionId]) {
    idx.sessions[sessionId] = { runIds: [], lastUpdated: null, meta: {} };
  }
  const s = idx.sessions[sessionId];
  if (!s.runIds.includes(runId)) s.runIds.push(runId);
  s.lastUpdated = new Date().toISOString();
  if (meta.cwd) s.meta.cwd = meta.cwd;
  ensureIndexDir();
  privateWriteFileSync(sessionsIndexPath(), JSON.stringify(idx, null, 2) + '\n');
}

function upsertCatalogEntry(entry, replace = false) {
  if (!replace && hasRunId(entry.runId)) return false;
  if (replace) {
    const rows = readCatalogJsonl().filter((r) => r.runId !== entry.runId);
    ensureIndexDir();
    privateWriteFileSync(catalogJsonlPath(), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  }
  appendCatalogEntry(entry);
  return true;
}

function rebuildIndex() {
  rebuildCatalogLatest();
  return { catalogCount: readCatalogJsonl().length };
}

module.exports = {
  readCatalogJsonl,
  hasRunId,
  appendCatalogEntry,
  upsertCatalogEntry,
  rebuildCatalogLatest,
  rebuildIndex,
  readSessionsIndex,
  updateSessionsIndex,
};
