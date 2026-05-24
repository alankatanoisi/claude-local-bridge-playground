'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildAutopsy, writeAutopsyFile, detectSemanticCycles } = require('../../src/runner/loop-autopsy');
const { SessionLedger } = require('../../src/runner/session-ledger');

describe('loop autopsy', () => {
  it('detects repeated tool calls', () => {
    const cycle = detectSemanticCycles([
      { name: 'read_file', args: { path: 'a' } },
      { name: 'read_file', args: { path: 'a' } },
      { name: 'read_file', args: { path: 'a' } },
      { name: 'read_file', args: { path: 'a' } },
    ]);
    assert.ok(cycle);
    assert.equal(cycle.kind, 'repeated_tool_call');
  });

  it('writes autopsy file without touching ledger', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopsy-'));
    const sessionPath = path.join(tmp, 'x.state.json');
    const ledger = new SessionLedger(sessionPath);
    ledger.append('session_started', { runId: 'r1' });
    const before = ledger.readAll().length;
    const autopsy = buildAutopsy({ toolHistory: [], stopReason: 'success', steps: 1, usage: {} });
    const out = writeAutopsyFile(sessionPath, autopsy);
    assert.ok(fs.existsSync(out));
    assert.equal(ledger.readAll().length, before);
  });
});
