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
const { ensurePrivateDir, privateAtomicWriteSync, openPrivateAppend } = require('./private-fs');

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
    // A crash can leave the final JSONL record without its terminating "\n".
    // We keep that raw fragment for forensic inspection, but the next valid
    // event must start on a fresh line so replay can still read it.
    this._needsTailDelimiter = false;

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
    if (!Number.isSafeInteger(cursor.seq) || cursor.seq < 0) return false;
    if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0) return false;
    let fileSize;
    try {
      fileSize = fs.statSync(this.filePath).size;
    } catch {
      return false;
    }
    if (cursor.offset !== fileSize) {
      // Any size mismatch means the cursor is not a complete description of
      // the ledger. Most importantly, a cursor behind the file can miss a
      // fully written event whose sequence and pending intent must be restored.
      return false;
    }
    if (fileSize > 0 && !this._fileEndsWithNewline(fileSize)) {
      // A cursor written by this class always points just after a newline.
      // An unterminated file therefore needs a scan, even if a damaged or
      // hand-edited cursor happens to claim the same byte length.
      return false;
    }
    this.lastSeq = cursor.seq;
    this.pendingIntents = Array.isArray(cursor.pendingIntents) ? cursor.pendingIntents : [];
    this._offset = cursor.offset;
    this._cursorSource = 'cursor';
    return true;
  }

  _fileEndsWithNewline(fileSize) {
    let fd;
    try {
      fd = fs.openSync(this.filePath, 'r');
      const lastByte = Buffer.alloc(1);
      fs.readSync(fd, lastByte, 0, 1, fileSize - 1);
      return lastByte[0] === 0x0a;
    } catch {
      // If we cannot prove that the cursor is on a complete JSONL boundary,
      // make the caller take the safer full-scan path.
      return false;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // best-effort descriptor cleanup
        }
      }
    }
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
    try {
      privateAtomicWriteSync(this.cursorPath, JSON.stringify(cursor) + '\n');
    } catch {
      // best-effort; cursor is an optimization, never a source of truth
    }
  }

  _loadLastSeq() {
    const contents = fs.readFileSync(this.filePath, 'utf8');
    // Both a partial JSON fragment and a complete record missing only its
    // newline need a delimiter before the first recovered append. The scan
    // below still counts the complete record, but naturally skips the partial.
    this._needsTailDelimiter = contents.length > 0 && !contents.endsWith('\n');
    const lines = contents.split('\n').filter(Boolean);
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
    ensurePrivateDir(path.dirname(this.filePath));
    this._fd = openPrivateAppend(this.filePath);
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
    // Put the recovery delimiter and the new event in ONE append operation.
    // That keeps the old bytes for forensics while avoiding a new crash window
    // in which only a standalone repair newline reached disk.
    const appendBytes = (this._needsTailDelimiter ? '\n' : '') + line;
    fs.writeSync(this._fd, appendBytes);
    this._offset += Buffer.byteLength(appendBytes, 'utf8');
    this._needsTailDelimiter = false;

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
