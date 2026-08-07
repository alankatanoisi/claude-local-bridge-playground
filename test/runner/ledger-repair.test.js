'use strict';

/**
 * F6 unit tests — applyRepair mutates; reconcileForResume covers the two
 * A1 failure shapes without needing a live process kill.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SessionLedger } = require('../../src/runner/session-ledger');
const { SessionStore } = require('../../src/runner/session-store');
const { assertValidAnthropicMessages } = require('../../src/runner/message-contract');
const {
  planRepair,
  applyRepair,
  reconcileForResume,
  SYNTHETIC_RECOVERED_TEXT,
  SYNTHETIC_ABORT_TEXT,
} = require('../../src/runner/ledger-repair');
const { replayFromLedger } = require('../../src/runner/replay-simulator');

function makeSession(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sessionPath = path.join(dir, 'f6.state.json');
  const store = new SessionStore(sessionPath);
  store.load();
  return { dir, sessionPath, store };
}

describe('ledger repair / applyRepair (F6)', () => {
  it('refuses mutation without approval', () => {
    const { sessionPath, store } = makeSession('f6-deny-');
    store.setMessages([{ role: 'user', content: 'hi' }]);
    store.flushSync();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('tool_effect_intent', { effectId: 'fx1', toolUseId: 'toolu_1', tool: 'write_file' });
    ledger.close();

    const plan = planRepair(sessionPath);
    const result = applyRepair(sessionPath, plan.repairPlan, false);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'repair_requires_approval');
    assert.equal(
      replayFromLedger(sessionPath).issues.some((i) => i.kind === 'pending_effect'),
      true,
    );
  });

  it('A1-F3: injects synthetic tool_result for dangling checkpoint tool_use and marks pending aborted', () => {
    const { sessionPath, store } = makeSession('f6-dangling-');
    store.setMessages([
      { role: 'user', content: 'write it' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'writing' },
          { type: 'tool_use', id: 'toolu_dangle', name: 'write_file', input: { path: 'x.txt', content: 'x' } },
        ],
      },
    ]);
    store.flushSync();

    const ledger = new SessionLedger(sessionPath);
    ledger.append('session_started', {});
    ledger.append('tool_effect_intent', {
      effectId: 'fx_dangle',
      toolUseId: 'toolu_dangle',
      tool: 'write_file',
    });
    ledger.close();

    const plan = planRepair(sessionPath);
    assert.ok(plan.repairPlan.some((a) => a.action === 'inject_synthetic_tool_result'));
    assert.ok(plan.repairPlan.some((a) => a.action === 'mark_pending_aborted'));

    const result = applyRepair(sessionPath, plan.repairPlan, true);
    assert.equal(result.applied, true);
    assert.equal(result.contractOk, true);
    assertValidAnthropicMessages(result.messages);

    const last = result.messages[result.messages.length - 1];
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].type, 'tool_result');
    assert.equal(last.content[0].tool_use_id, 'toolu_dangle');
    assert.match(last.content[0].content, /aborted|did not finish/i);

    const replay = replayFromLedger(sessionPath);
    assert.equal(replay.issues.filter((i) => i.kind === 'pending_effect').length, 0, 'pending effect marked aborted');
  });

  it('A1-F2: reconstructs completed ledger exchanges missing from a stale checkpoint', () => {
    const { sessionPath, store } = makeSession('f6-stale-');
    // Stale checkpoint: only the opening prompt survived the debounce window.
    store.setMessages([{ role: 'user', content: 'Write the effect files.' }]);
    store.flushSync();

    const ledger = new SessionLedger(sessionPath);
    ledger.append('session_started', {});
    ledger.append('tool_effect_intent', {
      effectId: 'fx_done1',
      toolUseId: 'toolu_done1',
      tool: 'write_file',
    });
    ledger.append('tool_effect_result', {
      effectId: 'fx_done1',
      toolUseId: 'toolu_done1',
      tool: 'write_file',
      ok: true,
    });
    ledger.append('tool_effect_intent', {
      effectId: 'fx_done2',
      toolUseId: 'toolu_done2',
      tool: 'write_file',
    });
    ledger.append('tool_effect_result', {
      effectId: 'fx_done2',
      toolUseId: 'toolu_done2',
      tool: 'write_file',
      ok: true,
    });
    ledger.close();

    const plan = planRepair(sessionPath);
    const recovered = plan.repairPlan.filter((a) => a.action === 'inject_recovered_exchange');
    assert.equal(recovered.length, 2);

    const result = applyRepair(sessionPath, plan.repairPlan, true);
    assert.equal(result.applied, true);
    assert.equal(result.contractOk, true);
    assertValidAnthropicMessages(result.messages);

    const resultIds = [];
    for (const msg of result.messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const b of msg.content) {
        if (b?.type === 'tool_result') resultIds.push(b.tool_use_id);
      }
    }
    assert.deepEqual(resultIds.sort(), ['toolu_done1', 'toolu_done2']);
    assert.match(JSON.stringify(result.messages), new RegExp(SYNTHETIC_RECOVERED_TEXT.slice(0, 40)));

    // Disk checkpoint was flushed.
    const reloaded = new SessionStore(sessionPath);
    reloaded.load();
    assert.ok(reloaded.messages.length >= 5, 'user + 2 recovered exchanges');
  });

  it('reconcileForResume auto-approves safe actions and is idempotent', () => {
    const { sessionPath, store } = makeSession('f6-resume-');
    store.setMessages([
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_r', name: 'write_file', input: { path: 'a.txt', content: 'a' } }],
      },
    ]);
    store.flushSync();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('tool_effect_intent', { effectId: 'fx_r', toolUseId: 'toolu_r', tool: 'write_file' });
    ledger.close();

    const first = reconcileForResume(sessionPath, store.messages);
    assert.equal(first.mutated, true);
    assertValidAnthropicMessages(first.messages);
    assert.match(first.messages[first.messages.length - 1].content[0].content, new RegExp('crash', 'i'));

    const second = reconcileForResume(sessionPath, first.messages);
    assert.equal(second.mutated, false, 'second reconcile is a no-op');
    assert.equal(second.plan.repairPlan.filter((a) => a.action !== 'report_gap').length, 0);
  });

  it('exposes synthetic copy constants for docs/tests', () => {
    assert.ok(SYNTHETIC_ABORT_TEXT.length > 20);
    assert.ok(SYNTHETIC_RECOVERED_TEXT.length > 20);
  });
});
