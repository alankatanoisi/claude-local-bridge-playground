'use strict';

const fs = require('fs');
const path = require('path');
const { archiveSessionDir, turnsDir } = require('./paths');
const { readSessionsIndex } = require('./indexer');

function updateSessionRollup(sessionId, runEntry) {
  if (!sessionId) return;
  const dir = archiveSessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });

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
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');

  const rollupPath = path.join(dir, 'rollup.jsonl');
  fs.appendFileSync(
    rollupPath,
    JSON.stringify({
      runId: runEntry.runId,
      startedAt: runEntry.startedAt,
      promptPreview: runEntry.promptPreview,
      stopReason: runEntry.stopReason,
    }) + '\n',
    'utf8',
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
  fs.writeFileSync(path.join(dir, 'turns.index.json'), JSON.stringify(turnsIndex, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'runs.json'), JSON.stringify(meta.runIds, null, 2) + '\n', 'utf8');
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
