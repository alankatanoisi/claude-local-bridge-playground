'use strict';

const fs = require('fs');
const { catalogJsonlPath, catalogLatestPath, sessionsIndexPath, indexDir } = require('./paths');

function ensureIndexDir() {
  if (!fs.existsSync(indexDir())) fs.mkdirSync(indexDir(), { recursive: true });
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
  fs.appendFileSync(catalogJsonlPath(), JSON.stringify(entry) + '\n', 'utf8');
}

function rebuildCatalogLatest() {
  const rows = readCatalogJsonl();
  rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
  ensureIndexDir();
  fs.writeFileSync(catalogLatestPath(), JSON.stringify(rows, null, 2) + '\n', 'utf8');
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
  fs.writeFileSync(sessionsIndexPath(), JSON.stringify(idx, null, 2) + '\n', 'utf8');
}

function upsertCatalogEntry(entry, replace = false) {
  if (!replace && hasRunId(entry.runId)) return false;
  if (replace) {
    const rows = readCatalogJsonl().filter((r) => r.runId !== entry.runId);
    ensureIndexDir();
    fs.writeFileSync(
      catalogJsonlPath(),
      rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
      'utf8',
    );
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
