'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { SessionLedger, makeEffectId } = require('../../src/runner/session-ledger');

describe('session ledger', () => {
  it('assigns monotonic sequence numbers', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
    const sessionPath = path.join(tmp, 'a.state.json');
    const ledger = new SessionLedger(sessionPath);
    const e1 = ledger.append('user_prompt', { prompt: 'hi' });
    const e2 = ledger.append('assistant_message', { text: 'hello' });
    assert.equal(e2.seq, e1.seq + 1);
    const events = ledger.readAll();
    assert.equal(events.length, 2);
    assert.deepEqual(ledger.detectGaps(), []);
  });

  it('tracks pending intents without matching results', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-pending-'));
    const sessionPath = path.join(tmp, 'b.state.json');
    const ledger = new SessionLedger(sessionPath);
    const fx = makeEffectId();
    ledger.append('tool_effect_intent', { effectId: fx, tool: 'write_file' });
    assert.equal(ledger.getPendingIntents().length, 1);
    ledger.append('tool_effect_result', { effectId: fx, ok: true });
    assert.equal(ledger.getPendingIntents().length, 0);
  });
});
