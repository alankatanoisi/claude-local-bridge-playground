'use strict';

/**
 * Append-only session ledger with monotonic sequence numbers.
 */

const fs = require('fs');
const path = require('path');

const LEDGER_VERSION = 1;

function ledgerPathForSession(sessionPath) {
  if (!sessionPath) return null;
  return sessionPath.replace(/\.state\.json$/, '.ledger.jsonl');
}

class SessionLedger {
  constructor(sessionPath) {
    this.sessionPath = sessionPath;
    this.filePath = ledgerPathForSession(sessionPath);
    this.lastSeq = 0;
    this.pendingIntents = [];
    if (this.filePath && fs.existsSync(this.filePath)) {
      this._loadLastSeq();
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
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8');

    if (type.endsWith('_intent') && payload.effectId) {
      this.pendingIntents.push({ seq, type, id: payload.effectId });
    }
    if (type.endsWith('_result') && payload.effectId) {
      this.pendingIntents = this.pendingIntents.filter((p) => p.id !== payload.effectId);
    }
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
}

function makeEffectId() {
  return 'fx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  LEDGER_VERSION,
  ledgerPathForSession,
  SessionLedger,
  makeEffectId,
};
