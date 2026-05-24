'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { HookDispatcher } = require('../../src/runner/hooks/hook-dispatcher');
const { SessionLedger } = require('../../src/runner/session-ledger');

describe('hook ledger ordering', () => {
  it('pre_tool hook sees last ledger event after intent append', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-order-'));
    fs.mkdirSync(path.join(tmp, '.bridge-runner'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.bridge-runner', 'hooks.json'),
      JSON.stringify({ trusted: true, hooks: [{ event: 'pre_tool', name: 'audit' }] }),
      'utf8',
    );
    const sessionPath = path.join(tmp, 's.state.json');
    const ledger = new SessionLedger(sessionPath);
    const hooks = new HookDispatcher(tmp, { trustedWorkspace: true, workspaceTrusted: true });

    const ev = ledger.append('tool_effect_intent', { effectId: 'fx1', tool: 'read_file' });
    hooks.noteLedgerEvent({ type: ev.type, seq: ev.seq, effectId: 'fx1' });
    const r = hooks.dispatch('pre_tool', { tool: 'read_file' });
    assert.equal(r.skipped, false);
    assert.equal(r.results[0].payload.afterLedger.type, 'tool_effect_intent');
    assert.equal(r.results[0].payload.afterLedger.seq, ev.seq);
  });

  it('skips hooks when workspace is not trusted', () => {
    const d = new HookDispatcher('/tmp', { trustedWorkspace: true, workspaceTrusted: false });
    assert.equal(d.dispatch('pre_tool', {}).skipped, true);
  });
});
