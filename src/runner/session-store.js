'use strict';

/**
 * Canonical session store — flat JSON source of truth for resume.
 *
 * Transcript JSONL remains an audit log; session file holds API messages + runner metadata.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const DEFAULT_DEBOUNCE_MS = 75;

const _trackedStores = new Set();
let _exitHookAttached = false;

function _attachExitHookOnce() {
  if (_exitHookAttached) return;
  _exitHookAttached = true;
  const flushAll = () => {
    for (const store of _trackedStores) {
      try {
        store.flushSync();
      } catch {
        // best-effort
      }
    }
  };
  process.on('exit', flushAll);
  process.on('uncaughtException', (err) => {
    flushAll();
    throw err;
  });
}

function makeSessionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return 'ses_' + ts + '_' + crypto.randomBytes(4).toString('hex');
}

function defaultSession(sessionId, overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: sessionId || makeSessionId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    runner: {
      undoLog: [],
      consecutiveToolFailures: 0,
      activeTaskIds: [],
      compactionGeneration: 0,
      flags: {},
    },
    metadata: {
      cwd: null,
      model: null,
      familyId: null,
      forkedFrom: null,
      forkTurn: null,
    },
    ...overrides,
  };
}

function sessionPathFor(baseDir, sessionId) {
  return path.join(baseDir, sessionId + '.state.json');
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

class SessionStore {
  /**
   * @param {string} filePath — absolute path to *.state.json
   */
  constructor(filePath) {
    this.filePath = filePath;
    this._data = null;
    this._dirty = false;
    this._timer = null;
    const envMs = parseInt(process.env.BRIDGE_RUNNER_SESSION_DEBOUNCE_MS, 10);
    this._debounceMs = Number.isFinite(envMs) && envMs >= 0 ? envMs : DEFAULT_DEBOUNCE_MS;
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  load() {
    if (!this.exists()) {
      const id = path.basename(this.filePath, '.state.json');
      this._data = defaultSession(id);
      return this._data;
    }
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.schemaVersion) parsed.schemaVersion = SCHEMA_VERSION;
    if (!parsed.runner) parsed.runner = defaultSession(parsed.sessionId).runner;
    if (!parsed.metadata) parsed.metadata = defaultSession(parsed.sessionId).metadata;
    this._data = parsed;
    return this._data;
  }

  data() {
    if (!this._data) this.load();
    return this._data;
  }

  get messages() {
    return this.data().messages;
  }

  setMessages(messages) {
    this.data().messages = messages;
    this.touch();
  }

  appendMessage(message) {
    this.data().messages.push(message);
    this.touch();
  }

  updateRunner(patch) {
    Object.assign(this.data().runner, patch);
    this.touch();
  }

  updateMetadata(patch) {
    Object.assign(this.data().metadata, patch);
    this.touch();
  }

  touch() {
    this.data().updatedAt = new Date().toISOString();
    this._dirty = true;
  }

  save() {
    if (!this._data) return;
    this.touch();
    atomicWriteJson(this.filePath, this._data);
    this._dirty = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  saveSoon() {
    if (!this._data) return;
    this._dirty = true;
    if (this._debounceMs === 0) {
      this.save();
      return;
    }
    if (this._timer) return;
    _trackedStores.add(this);
    _attachExitHookOnce();
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._dirty || !this._data) return;
      try {
        atomicWriteJson(this.filePath, this._data);
        this._dirty = false;
      } catch {
        // swallow — next saveSoon/flushSync will retry
      }
    }, this._debounceMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  flushSync() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._dirty || !this._data) return;
    atomicWriteJson(this.filePath, this._data);
    this._dirty = false;
  }

  dispose() {
    this.flushSync();
    _trackedStores.delete(this);
  }

  /** Fork this session to a new file; returns new SessionStore. */
  fork(newPath, forkTurn) {
    const copy = JSON.parse(JSON.stringify(this.data()));
    copy.sessionId = path.basename(newPath, '.state.json');
    copy.metadata.forkedFrom = this.data().sessionId;
    copy.metadata.forkTurn = forkTurn ?? null;
    copy.metadata.familyId = copy.metadata.familyId || this.data().sessionId;
    copy.createdAt = new Date().toISOString();
    const store = new SessionStore(newPath);
    store._data = copy;
    store.save();
    return store;
  }
}

function resolveSessionPath(options) {
  if (options.sessionPath) return options.sessionPath;
  if (options.sessionId) {
    const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
    const dir = path.join(home, '.bridge-runner', 'sessions');
    return sessionPathFor(dir, options.sessionId);
  }
  return null;
}

module.exports = {
  SCHEMA_VERSION,
  SessionStore,
  defaultSession,
  makeSessionId,
  sessionPathFor,
  atomicWriteJson,
  resolveSessionPath,
};
