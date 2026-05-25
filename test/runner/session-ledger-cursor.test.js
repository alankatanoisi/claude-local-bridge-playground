'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  SessionLedger,
  makeEffectId,
  cursorPathForLedger,
  ledgerPathForSession,
} = require('../../src/runner/session-ledger');

function newLedger(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-cursor-' + label + '-'));
  const sessionPath = path.join(tmp, 's.state.json');
  return { sessionPath, tmp };
}

describe('SessionLedger cursor (C2)', () => {
  it('writes a cursor sidecar after each append', () => {
    const { sessionPath } = newLedger('write');
    const ledger = new SessionLedger(sessionPath);
    ledger.append('user_prompt', { prompt: 'hi' });
    const cursorPath = cursorPathForLedger(ledgerPathForSession(sessionPath));
    assert.ok(fs.existsSync(cursorPath), 'cursor sidecar exists');
    const cursor = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
    assert.equal(cursor.seq, 1);
    assert.ok(cursor.offset > 0);
    ledger.close();
  });

  it('resume restores lastSeq + pendingIntents from cursor without re-scan', () => {
    const { sessionPath } = newLedger('restore');
    const ledger = new SessionLedger(sessionPath);
    const fx = makeEffectId();
    ledger.append('user_prompt', { prompt: 'first' });
    ledger.append('tool_effect_intent', { effectId: fx, tool: 'write_file' });
    ledger.append('assistant_message', { text: 'ack' });
    ledger.close();

    const resumed = new SessionLedger(sessionPath);
    assert.equal(resumed.lastSeq, 3);
    assert.equal(resumed.getPendingIntents().length, 1);
    assert.equal(resumed.getCursor().source, 'cursor', 'restored from cursor, not scan');
    resumed.close();
  });

  it('falls back to full scan when the cursor is corrupt', () => {
    const { sessionPath } = newLedger('corrupt');
    const ledger = new SessionLedger(sessionPath);
    ledger.append('user_prompt', { prompt: 'x' });
    ledger.append('assistant_message', { text: 'ack' });
    ledger.close();

    const cursorPath = cursorPathForLedger(ledgerPathForSession(sessionPath));
    fs.writeFileSync(cursorPath, '{ not valid json');

    const resumed = new SessionLedger(sessionPath);
    assert.equal(resumed.lastSeq, 2);
    assert.equal(resumed.getCursor().source, 'scan', 'fell back to scan on corrupt cursor');
    resumed.close();
  });

  it('falls back to full scan when the cursor is ahead of the file', () => {
    const { sessionPath } = newLedger('ahead');
    const ledger = new SessionLedger(sessionPath);
    ledger.append('user_prompt', { prompt: 'x' });
    ledger.close();

    const cursorPath = cursorPathForLedger(ledgerPathForSession(sessionPath));
    const stale = JSON.parse(fs.readFileSync(cursorPath, 'utf8'));
    stale.offset = stale.offset + 1_000_000;
    fs.writeFileSync(cursorPath, JSON.stringify(stale));

    const resumed = new SessionLedger(sessionPath);
    assert.equal(resumed.getCursor().source, 'scan');
    resumed.close();
  });

  it('cursor pendingIntents survive resume without re-reading the file', () => {
    const { sessionPath } = newLedger('intents');
    const ledger = new SessionLedger(sessionPath);
    const fx1 = makeEffectId();
    const fx2 = makeEffectId();
    ledger.append('tool_effect_intent', { effectId: fx1, tool: 'write_file' });
    ledger.append('tool_effect_intent', { effectId: fx2, tool: 'edit_file' });
    ledger.append('tool_effect_result', { effectId: fx1, ok: true });
    ledger.close();

    const resumed = new SessionLedger(sessionPath);
    const pending = resumed.getPendingIntents();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, fx2);
    resumed.close();
  });
});
