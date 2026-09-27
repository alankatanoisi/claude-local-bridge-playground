'use strict';

const fs = require('fs');
const path = require('path');

const { safeArtifactName } = require('./artifact-name');

class TornLedgerLineError extends Error {
  constructor({ eventsPath, lineNumber, lastGoodEvent, cause }) {
    const lastGood = lastGoodEvent ? `${lastGoodEvent.type} seq=${lastGoodEvent.seq}` : 'none';
    super(
      `Cannot resume: ${eventsPath} has a torn trailing JSONL line at line ${lineNumber}; ` +
        `last good event was ${lastGood}. Refusing to skip the line because it may be a ` +
        'completed-work receipt. Restore or repair the ledger from verified evidence before retrying.',
      { cause },
    );
    this.name = 'TornLedgerLineError';
    this.eventsPath = eventsPath;
    this.lineNumber = lineNumber;
    this.lastGoodSeq = lastGoodEvent?.seq ?? null;
    this.lastGoodType = lastGoodEvent?.type ?? null;
  }
}

function readLedgerEvents(eventsPath) {
  const lines = fs
    .readFileSync(eventsPath, 'utf8')
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0);
  const events = [];

  for (let index = 0; index < lines.length; index += 1) {
    const { line, lineNumber } = lines[index];
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      // A malformed MIDDLE line remains the original parse error: the named
      // diagnosis is specifically for the common crash shape where only the
      // final append was torn. In every case reopening still fails closed.
      if (index !== lines.length - 1) throw error;
      throw new TornLedgerLineError({
        eventsPath,
        lineNumber,
        lastGoodEvent: events.at(-1),
        cause: error,
      });
    }
  }
  return events;
}

class RunLedger {
  constructor(runDir) {
    this.runDir = runDir;
    this.eventsPath = path.join(runDir, 'events.jsonl');
    this.statePath = path.join(runDir, 'state.json');
    this.artifactDir = path.join(runDir, 'artifacts');
    this.seq = 0;
    fs.mkdirSync(this.artifactDir, { recursive: true });
    // R10: reopening an existing run (resume-synthesis) must CONTINUE the
    // sequence, never restart at 1 — appended corrections stay ordered after
    // the original events.
    if (fs.existsSync(this.eventsPath)) {
      // Do not step over a torn receipt to find the next sequence number.
      // Every reopening path, including synthesis-only resume, receives the
      // same actionable refusal before it can append more evidence.
      for (const event of readLedgerEvents(this.eventsPath)) {
        if (event.seq > this.seq) this.seq = event.seq;
      }
    }
  }

  append(type, payload = {}) {
    const event = { seq: ++this.seq, at: new Date().toISOString(), type, payload };
    // Persist each receipt before reporting success. A signal handler cannot
    // help after SIGKILL, so durability belongs here, on the write itself.
    const fd = fs.openSync(this.eventsPath, 'a', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(event) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return event;
  }

  writeArtifact(name, value) {
    const safeName = safeArtifactName(name);
    const file = path.join(this.artifactDir, safeName + '.json');
    atomicWrite(file, value);
    return path.relative(this.runDir, file);
  }

  checkpoint(state) {
    atomicWrite(this.statePath, { ...state, lastSeq: this.seq, updatedAt: new Date().toISOString() });
  }
}

// Write-then-rename so a reader never sees a half-written file, AND fsync so
// the bytes survive a kill (thermo-nuclear Medium #3). Before this, events
// were fsync'd per line but checkpoints and artifacts were not, so after a
// SIGKILL events.jsonl could be ahead of state.json; if the lost checkpoint
// was the `completed` one, resume would buy the synthesis a second time.
//   1. fsync the temp file: its contents are on disk before the rename.
//   2. rename: atomic replacement of the visible path.
//   3. fsync the directory: the rename itself (the directory entry) is on
//      disk. Without this a crash can leave the OLD file visible even though
//      rename() returned.
function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  fsyncDirectory(path.dirname(file));
}

function fsyncDirectory(dir) {
  // Opening a directory read-only for fsync works on macOS and Linux; some
  // platforms (Windows) refuse it. Durability of the rename is best-effort
  // there, but the file contents above were already fsync'd.
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // best effort: platform cannot fsync a directory handle
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { RunLedger, TornLedgerLineError, atomicWrite, readLedgerEvents };
