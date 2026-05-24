'use strict';

/**
 * Auto-memory — four-type taxonomy with two-step save invariant.
 */

const fs = require('fs');
const path = require('path');

const INDEX_CAP = 50;
const TYPE_CAPS = Object.freeze({
  user: 10,
  feedback: 10,
  project: 20,
  reference: 10,
});

const VALID_TYPES = Object.freeze(['user', 'feedback', 'project', 'reference']);

function autoMemoryDir(cwd) {
  return path.join(cwd, '.bridge-runner', 'auto-memory');
}

function indexPath(cwd) {
  return path.join(autoMemoryDir(cwd), 'index.json');
}

function loadAutoMemoryIndex(cwd) {
  const p = indexPath(cwd);
  if (!fs.existsSync(p)) return { entries: [], cap: INDEX_CAP };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { entries: [], cap: INDEX_CAP };
  }
}

/**
 * Two-step save invariant: write topic file, then update index.
 */
function saveAutoMemoryTopic(cwd, topicId, body, type = 'project') {
  const memType = VALID_TYPES.includes(type) ? type : 'project';
  const dir = autoMemoryDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const topicPath = path.join(dir, topicId + '.md');

  // Step 1: topic file
  fs.writeFileSync(topicPath, body, 'utf8');

  // Step 2: index (on failure, topic exists but index may be stale — caller should retry index)
  const index = loadAutoMemoryIndex(cwd);
  const now = new Date().toISOString();
  const existing = index.entries.findIndex((e) => e.id === topicId);
  const entry = { id: topicId, updatedAt: now, type: memType };
  if (existing >= 0) index.entries[existing] = entry;
  else index.entries.unshift(entry);

  // Enforce per-type caps then global cap
  for (const t of VALID_TYPES) {
    const cap = TYPE_CAPS[t];
    const ofType = index.entries.filter((e) => e.type === t);
    if (ofType.length > cap) {
      const removeIds = new Set(ofType.slice(cap).map((e) => e.id));
      index.entries = index.entries.filter((e) => !removeIds.has(e.id));
    }
  }
  if (index.entries.length > INDEX_CAP) {
    index.entries = index.entries.slice(0, INDEX_CAP);
  }

  fs.writeFileSync(indexPath(cwd), JSON.stringify(index, null, 2) + '\n', 'utf8');
  return { topicPath, index, type: memType };
}

function listAutoMemoryMetadata(cwd) {
  const index = loadAutoMemoryIndex(cwd);
  return index.entries.slice(0, 20).map((e) => ({
    id: e.id,
    type: e.type,
    updatedAt: e.updatedAt,
  }));
}

module.exports = {
  INDEX_CAP,
  TYPE_CAPS,
  VALID_TYPES,
  autoMemoryDir,
  loadAutoMemoryIndex,
  saveAutoMemoryTopic,
  listAutoMemoryMetadata,
};
