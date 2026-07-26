'use strict';

const fs = require('fs');
const path = require('path');
// A7: session rollups are runner-owned artifacts — explicit 0700/0600, not umask.
const { ensurePrivateDir, privateWriteFileSync, privateAppendFileSync } = require('../private-fs');
const { archiveSessionDir, turnsDir } = require('./paths');
const { readSessionsIndex } = require('./indexer');

function updateSessionRollup(sessionId, runEntry) {
  if (!sessionId) return;
  const dir = archiveSessionDir(sessionId);
  ensurePrivateDir(dir);

  const metaPath = path.join(dir, 'meta.json');
  let meta = { sessionId, runIds: [], updatedAt: new Date().toISOString() };
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      // reset
    }
  }
  if (!meta.runIds.includes(runEntry.runId)) meta.runIds.push(runEntry.runId);
  meta.updatedAt = new Date().toISOString();
  privateWriteFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');

  const rollupPath = path.join(dir, 'rollup.jsonl');
  privateAppendFileSync(
    rollupPath,
    JSON.stringify({
      runId: runEntry.runId,
      startedAt: runEntry.startedAt,
      promptPreview: runEntry.promptPreview,
      stopReason: runEntry.stopReason,
    }) + '\n',
  );

  const turnsIndex = { runs: [] };
  for (const rid of meta.runIds) {
    const tdir = turnsDir(rid);
    const files = fs.existsSync(tdir)
      ? fs
          .readdirSync(tdir)
          .filter((f) => f.endsWith('.json'))
          .sort()
      : [];
    turnsIndex.runs.push({ runId: rid, turnFiles: files });
  }
  privateWriteFileSync(path.join(dir, 'turns.index.json'), JSON.stringify(turnsIndex, null, 2) + '\n');
  privateWriteFileSync(path.join(dir, 'runs.json'), JSON.stringify(meta.runIds, null, 2) + '\n');
}

function getSessionSummary(sessionId) {
  const idx = readSessionsIndex();
  const s = idx.sessions?.[sessionId];
  const dir = archiveSessionDir(sessionId);
  return {
    sessionId,
    index: s || null,
    dir: fs.existsSync(dir) ? dir : null,
    meta: fs.existsSync(path.join(dir, 'meta.json'))
      ? JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
      : null,
  };
}

module.exports = {
  updateSessionRollup,
  getSessionSummary,
};
