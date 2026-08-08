'use strict';

/**
 * false-green-ledger-durability.test.js — FG-L series.
 *
 * SCENARIO THIS FILE DEFENDS (hypothetical change HC-5):
 *   "Close A1-F4/A1-F5: the ledger does a writeSync plus an atomic cursor
 *    rewrite on EVERY event, which dominates turn latency. Batch appends in
 *    memory and flush every N events or every M milliseconds."
 *
 * This is the most dangerous kind of change in the repo, because the thing it
 * weakens — durability — is by definition only observable when the process dies,
 * and no in-process test kills a process. The suite has real crash tests
 * (ledger-crash-recovery.test.js spawns and SIGKILLs a runner), but they are
 * slow, few, and they assert on the SHAPE of what survived rather than on the
 * write-path invariants that make survival possible.
 *
 * A batching implementation passes today's suite trivially: within one process,
 * a buffered writer that flushes on read is indistinguishable from a synchronous
 * one. Everything below is a property that stays true for `writeSync` and breaks
 * the moment a buffer is introduced — checked without killing anything.
 *
 *   FG-L1  a record is on disk as soon as append() returns
 *   FG-L2  the in-memory offset never lies about the file size
 *   FG-L3  a crash with no close() loses nothing (the "we never got to flush" case)
 *   FG-L4  cursor-restored state and full-scan state agree exactly
 *   FG-L5  the ledger and its cursor stay owner-only on disk
 *   FG-L6  concurrent writers never interleave a partial line
 *
 * FG-F6..F9 already cover torn tails, cursor-past-EOF and schema-version
 * fallback; this file deliberately does not repeat them.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SessionLedger,
  ledgerPathForSession,
  cursorPathForLedger,
  makeEffectId,
} = require('../../src/runner/session-ledger');

function newSession() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-ledger-'));
  const sessionPath = path.join(dir, 'run.state.json');
  return { dir, sessionPath, ledgerPath: ledgerPathForSession(sessionPath) };
}

/** Parse the ledger file the way a recovery tool would: strictly, line by line. */
function readLinesStrict(ledgerPath) {
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`line ${i + 1} is not valid JSON (${err.message}): ${JSON.stringify(line.slice(0, 120))}`);
    }
  });
}

describe('FG-L ledger write-path durability', () => {
  // FG-L1: the defining property of an append-only ledger. If append() returns
  // before the bytes are on disk, every crash-recovery guarantee in the repo is
  // downgraded from "durable" to "probably". A buffered writer fails here.
  it('FG-L1: a record is readable from disk immediately after append() returns', () => {
    const { sessionPath, ledgerPath } = newSession();
    const ledger = new SessionLedger(sessionPath);

    for (let i = 1; i <= 5; i++) {
      ledger.append('turn_started', { turn: i });
      // Read through the filesystem, NOT through ledger.readAll(), so a
      // flush-on-read implementation cannot disguise itself.
      const onDisk = readLinesStrict(ledgerPath);
      assert.equal(onDisk.length, i, `after ${i} appends only ${onDisk.length} record(s) reached disk`);
      assert.equal(onDisk[i - 1].seq, i, 'sequence numbers must be written in order');
    }
    ledger.close();
  });

  // FG-L2: the cursor is a byte OFFSET into the ledger. Resume seeks to it. If
  // the in-memory offset counts bytes that are still sitting in a buffer, the
  // cursor points into the future — and FG-F7's "cursor past EOF" guard would
  // start firing on every clean run, silently degrading every resume to a full
  // scan (slower, but still green).
  it('FG-L2: the tracked offset always equals the real file size', () => {
    const { sessionPath, ledgerPath } = newSession();
    const ledger = new SessionLedger(sessionPath);

    for (let i = 0; i < 8; i++) {
      ledger.append('tool_intent', { effectId: makeEffectId(), note: 'x'.repeat(i * 7) });
      assert.equal(
        ledger.getCursor().offset,
        fs.statSync(ledgerPath).size,
        `offset diverged from file size after append ${i + 1}`,
      );
    }
    ledger.close();
  });

  // FG-L3: the crash case, in process. A run that dies never calls close(). Open
  // a SECOND ledger on the same path without closing the first — that is exactly
  // what the next run does after a hard kill — and assert nothing was lost.
  it('FG-L3: a ledger abandoned without close() has already persisted every record', () => {
    const { sessionPath, ledgerPath } = newSession();
    const dying = new SessionLedger(sessionPath);
    dying.append('run_started', {});
    dying.append('turn_started', { turn: 1 });
    dying.append('tool_intent', { effectId: 'fx_abc' });
    // No close(), no flush — simulate SIGKILL.

    const recovered = new SessionLedger(sessionPath);
    assert.equal(recovered.lastSeq, 3, 'recovery must see all three records');
    assert.deepEqual(
      recovered.getPendingIntents().map((p) => p.id),
      ['fx_abc'],
      'an unmatched intent must survive the crash',
    );
    assert.equal(readLinesStrict(ledgerPath).length, 3, 'all three records must be parseable on disk');

    // And appends continue from the right sequence rather than overwriting.
    recovered.append('tool_result', { effectId: 'fx_abc' });
    assert.equal(recovered.lastSeq, 4);
    assert.deepEqual(recovered.getPendingIntents(), [], 'the matching result must clear the pending intent');
    assert.deepEqual(
      readLinesStrict(ledgerPath).map((e) => e.seq),
      [1, 2, 3, 4],
      'sequence must be gapless',
    );
    recovered.close();
  });

  // FG-L4: cursor-restore and full-scan are two independent readers of the same
  // truth. FG-F7/F8 prove the FALLBACK triggers; nothing proved the two paths
  // AGREE. If batching made the cursor lag the file, resume would quietly start
  // from a stale sequence and replay or skip effects.
  it('FG-L4: cursor-restored state is identical to full-scan state', () => {
    const { sessionPath, ledgerPath } = newSession();
    const writer = new SessionLedger(sessionPath);
    writer.append('run_started', {});
    writer.append('tool_intent', { effectId: 'fx_1' });
    writer.append('tool_result', { effectId: 'fx_1' });
    writer.append('tool_intent', { effectId: 'fx_2' }); // deliberately left pending
    writer.close();

    const viaCursor = new SessionLedger(sessionPath);
    assert.equal(viaCursor.getCursor().source, 'cursor', 'this run must exercise the cursor path');

    // Remove the sidecar and reopen: same file, scan path.
    fs.unlinkSync(cursorPathForLedger(ledgerPath));
    const viaScan = new SessionLedger(sessionPath);
    assert.equal(viaScan.getCursor().source, 'scan', 'this run must exercise the scan path');

    assert.equal(viaCursor.lastSeq, viaScan.lastSeq, 'lastSeq disagrees between cursor and scan recovery');
    assert.equal(viaCursor.getCursor().offset, viaScan.getCursor().offset, 'offset disagrees between the two paths');
    assert.deepEqual(
      viaCursor
        .getPendingIntents()
        .map((p) => p.id)
        .sort(),
      viaScan
        .getPendingIntents()
        .map((p) => p.id)
        .sort(),
      'pending intents disagree between cursor and scan recovery',
    );
    assert.deepEqual(
      viaScan.getPendingIntents().map((p) => p.id),
      ['fx_2'],
    );
    assert.deepEqual(viaScan.detectGaps(), [], 'a clean ledger must report no sequence gaps');
  });

  // FG-L5: ledgers contain prompts and file paths (CLAUDE.md says so explicitly).
  // They are written through private-fs to stay owner-only. A new write path —
  // exactly what a batching rewrite introduces — is the standard way that mode
  // is lost, and nothing else in the suite looks at the mode bits of these files.
  it('FG-L5: the ledger and its cursor are owner-only on disk', () => {
    if (process.platform === 'win32') return; // POSIX mode bits only
    const { sessionPath, ledgerPath } = newSession();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('run_started', { prompt: 'contains user content' });
    ledger.close();

    const ledgerMode = fs.statSync(ledgerPath).mode & 0o777;
    assert.equal(ledgerMode, 0o600, `ledger mode is ${ledgerMode.toString(8)}, expected 600 — it holds prompt text`);

    const cursorFile = cursorPathForLedger(ledgerPath);
    if (fs.existsSync(cursorFile)) {
      const cursorMode = fs.statSync(cursorFile).mode & 0o777;
      assert.equal(cursorMode, 0o600, `cursor mode is ${cursorMode.toString(8)}, expected 600`);
    }

    const dirMode = fs.statSync(path.dirname(ledgerPath)).mode & 0o777;
    assert.equal(dirMode, 0o700, `ledger directory mode is ${dirMode.toString(8)}, expected 700`);
  });

  // FG-L6: whole-line atomicity. Two runners sharing a session path (a resume
  // racing the original, or a coordinator and a worker) each append through
  // their own fd in O_APPEND mode, where a single write syscall is atomic. A
  // buffered writer that flushes half-lines turns the other writer's records
  // into garbage — and the loss shows up only in the OTHER process's data, which
  // is why no single-writer test would catch it.
  it('FG-L6: interleaved writers never produce a partial line', () => {
    const { sessionPath, ledgerPath } = newSession();
    const a = new SessionLedger(sessionPath);
    const b = new SessionLedger(sessionPath);

    for (let i = 0; i < 20; i++) {
      a.append('writer_a', { i, pad: 'a'.repeat(50) });
      b.append('writer_b', { i, pad: 'b'.repeat(50) });
    }
    a.close();
    b.close();

    // Every line must be complete JSON — this is the assertion that fails if a
    // flush ever emits a fragment.
    const events = readLinesStrict(ledgerPath);
    assert.equal(events.length, 40, `expected 40 whole records, found ${events.length}`);
    assert.equal(events.filter((e) => e.type === 'writer_a').length, 20);
    assert.equal(events.filter((e) => e.type === 'writer_b').length, 20);
    for (const e of events) {
      assert.equal(e.v, 1, 'every record must carry the ledger version');
      assert.ok(typeof e.seq === 'number' && e.seq > 0, 'every record must carry a sequence number');
      assert.ok(typeof e.ts === 'string', 'every record must carry a timestamp');
    }
  });

  // FG-L7: readAll() and the raw file must never disagree about how many records
  // exist. readAll() is what replay and repair tooling use; if a buffering
  // implementation made it flush-then-read while a crash-recovery tool read the
  // file directly, the two would see different histories.
  it('FG-L7: readAll() agrees with a direct read of the file', () => {
    const { sessionPath, ledgerPath } = newSession();
    const ledger = new SessionLedger(sessionPath);
    for (let i = 0; i < 6; i++) ledger.append('turn_started', { turn: i });

    const viaApi = ledger.readAll();
    const viaDisk = readLinesStrict(ledgerPath);
    assert.equal(viaApi.length, viaDisk.length, 'readAll() and the on-disk file disagree on record count');
    assert.deepEqual(
      viaApi.map((e) => e.seq),
      viaDisk.map((e) => e.seq),
      'readAll() and the on-disk file disagree on sequence numbers',
    );
    assert.deepEqual(ledger.detectGaps(), []);
    ledger.close();
  });
});
