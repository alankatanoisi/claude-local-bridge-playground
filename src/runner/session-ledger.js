'use strict';

/**
 * Append-only session ledger with monotonic sequence numbers.
 *
 * C2: writes go through a kept-open fd (openSync + writeSync) instead of
 * appendFileSync, which would open+close on every event. A small cursor
 * sidecar (`<ledger>.cursor.json`) tracks { seq, offset, pendingIntents }
 * so resume can skip the full file scan.
 */

const fs = require('fs');
const path = require('path');

const LEDGER_VERSION = 1;

function ledgerPathForSession(sessionPath) {
  if (!sessionPath) return null;
  return sessionPath.replace(/\.state\.json$/, '.ledger.jsonl');
}

function cursorPathForLedger(ledgerPath) {
  if (!ledgerPath) return null;
  return ledgerPath + '.cursor.json';
}

class SessionLedger {
  constructor(sessionPath) {
    this.sessionPath = sessionPath;
    this.filePath = ledgerPathForSession(sessionPath);
    this.cursorPath = cursorPathForLedger(this.filePath);
    this.lastSeq = 0;
    this.pendingIntents = [];
    this._fd = null;
    this._offset = 0;
    this._cursorSource = null; // 'cursor' | 'scan' | null

    if (this.filePath && fs.existsSync(this.filePath)) {
      const restored = this._restoreFromCursor();
      if (!restored) this._loadLastSeq();
    }
  }

  _restoreFromCursor() {
    if (!this.cursorPath || !fs.existsSync(this.cursorPath)) return false;
    let cursor;
    try {
      cursor = JSON.parse(fs.readFileSync(this.cursorPath, 'utf8'));
    } catch {
      return false;
    }
    if (cursor.v !== LEDGER_VERSION) return false;
    if (typeof cursor.seq !== 'number' || typeof cursor.offset !== 'number') return false;
    let fileSize;
    try {
      fileSize = fs.statSync(this.filePath).size;
    } catch {
      return false;
    }
    if (cursor.offset > fileSize) {
      // cursor ahead of file → corruption; fall back to full scan
      return false;
    }
    this.lastSeq = cursor.seq;
    this.pendingIntents = Array.isArray(cursor.pendingIntents) ? cursor.pendingIntents : [];
    this._offset = cursor.offset;
    this._cursorSource = 'cursor';
    return true;
  }

  _writeCursor() {
    if (!this.cursorPath) return;
    const cursor = {
      v: LEDGER_VERSION,
      seq: this.lastSeq,
      offset: this._offset,
      ts: new Date().toISOString(),
      pendingIntents: this.pendingIntents,
    };
    const tmp = this.cursorPath + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmp, JSON.stringify(cursor) + '\n', 'utf8');
      fs.renameSync(tmp, this.cursorPath);
    } catch {
      // best-effort; cursor is an optimization, never a source of truth
    }
  }

  _loadLastSeq() {
    const lines = fs.readFileSync(this.filePath, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.seq > this.lastSeq) this.lastSeq = ev.seq;
        if (ev.type && ev.type.endsWith('_intent')) {
          this.pendingIntents.push({ seq: ev.seq, type: ev.type, id: ev.effectId });
        }
        if (ev.type && ev.type.endsWith('_result') && ev.effectId) {
          this.pendingIntents = this.pendingIntents.filter((p) => p.id !== ev.effectId);
        }
      } catch {
        // skip corrupt line
      }
    }
    try {
      this._offset = fs.statSync(this.filePath).size;
    } catch {
      this._offset = 0;
    }
    this._cursorSource = 'scan';
  }

  _ensureFd() {
    if (this._fd !== null) return;
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this._fd = fs.openSync(this.filePath, 'a');
    if (this._offset === 0) {
      try {
        this._offset = fs.statSync(this.filePath).size;
      } catch {
        this._offset = 0;
      }
    }
  }

  append(type, payload = {}) {
    if (!this.filePath) return null;
    const seq = ++this.lastSeq;
    const event = {
      v: LEDGER_VERSION,
      seq,
      ts: new Date().toISOString(),
      type,
      ...payload,
    };
    const line = JSON.stringify(event) + '\n';
    this._ensureFd();
    fs.writeSync(this._fd, line);
    this._offset += Buffer.byteLength(line, 'utf8');

    if (type.endsWith('_intent') && payload.effectId) {
      this.pendingIntents.push({ seq, type, id: payload.effectId });
    }
    if (type.endsWith('_result') && payload.effectId) {
      this.pendingIntents = this.pendingIntents.filter((p) => p.id !== payload.effectId);
    }
    this._writeCursor();
    return event;
  }

  readAll() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return [];
    return fs
      .readFileSync(this.filePath, 'utf8')
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

  getPendingIntents() {
    return [...this.pendingIntents];
  }

  getCursor() {
    return {
      v: LEDGER_VERSION,
      seq: this.lastSeq,
      offset: this._offset,
      pendingIntents: this.pendingIntents,
      source: this._cursorSource,
    };
  }

  detectGaps() {
    const events = this.readAll();
    const gaps = [];
    for (let i = 1; i < events.length; i++) {
      if (events[i].seq !== events[i - 1].seq + 1) {
        gaps.push({ after: events[i - 1].seq, found: events[i].seq });
      }
    }
    return gaps;
  }

  close() {
    if (this._fd !== null) {
      try {
        fs.closeSync(this._fd);
      } catch {
        // best-effort
      }
      this._fd = null;
    }
  }
}

function makeEffectId() {
  return 'fx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  LEDGER_VERSION,
  ledgerPathForSession,
  cursorPathForLedger,
  SessionLedger,
  makeEffectId,
};
