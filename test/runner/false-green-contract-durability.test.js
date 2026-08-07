'use strict';

/**
 * false-green-contract-durability.test.js — wire-contract + ledger edges (FG-F).
 *
 * Two families:
 *   FG-F1..F5 — Anthropic message-contract adversarial shapes and the
 *     partition property of semantic-exchange grouping (what compaction relies
 *     on). The existing message-contract tests pin five shapes; these cover
 *     the cross-turn and generated-history cases a compaction refactor could
 *     silently break.
 *   FG-F6..F9 — session-ledger durability edges: torn JSONL tails, corrupt
 *     cursor sidecars, and intent/result reconciliation across restarts. The
 *     crash bakeoff kills real processes; these pin the byte-level parsing
 *     behavior those recoveries depend on.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertValidAnthropicMessages,
  groupSemanticExchanges,
  MessageContractError,
} = require('../../src/runner/message-contract');
const { SessionLedger, ledgerPathForSession, cursorPathForLedger } = require('../../src/runner/session-ledger');

function textMsg(role, text) {
  return { role, content: [{ type: 'text', text }] };
}
function toolUseMsg(ids) {
  return { role: 'assistant', content: ids.map((id) => ({ type: 'tool_use', id, name: 'read_file', input: {} })) };
}
function toolResultMsg(ids) {
  return { role: 'user', content: ids.map((id) => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })) };
}

describe('FG-F message-contract adversarial shapes', () => {
  it('FG-F1: duplicate tool_use ids across DIFFERENT assistant turns are rejected', () => {
    // Resume/repair code stitches history from the ledger; a replay bug that
    // reuses an id in a later turn must be caught before network I/O.
    const messages = [
      textMsg('user', 'go'),
      toolUseMsg(['toolu_dup']),
      toolResultMsg(['toolu_dup']),
      toolUseMsg(['toolu_dup']), // same id, new turn
      toolResultMsg(['toolu_dup']),
    ];
    assert.throws(() => assertValidAnthropicMessages(messages), MessageContractError);
  });

  it('FG-F2: a tool_result batch split across two user messages is rejected', () => {
    const messages = [
      textMsg('user', 'go'),
      toolUseMsg(['toolu_a', 'toolu_b']),
      toolResultMsg(['toolu_a']), // half the batch
      toolResultMsg(['toolu_b']), // other half — not adjacent to its tool_use
    ];
    assert.throws(() => assertValidAnthropicMessages(messages), MessageContractError);
  });

  it('FG-F3: plain string-content messages interleave fine with tool batches', () => {
    const messages = [
      { role: 'user', content: 'plain string prompt' },
      toolUseMsg(['toolu_1']),
      toolResultMsg(['toolu_1']),
      { role: 'assistant', content: 'plain string answer' },
    ];
    assert.equal(assertValidAnthropicMessages(messages), true);
  });

  it('FG-F4: grouping is a partition — concatenated groups reproduce the history exactly', () => {
    // Compaction drops or keeps whole groups. If grouping ever skips or
    // duplicates a message, compaction would corrupt history while its own
    // unit tests (which inspect one group) stay green. Property-check a
    // generated 30-exchange history.
    const messages = [];
    for (let i = 0; i < 30; i++) {
      messages.push(textMsg('user', 'instruction ' + i));
      if (i % 3 === 0) {
        const ids = ['toolu_g' + i + '_a', 'toolu_g' + i + '_b'];
        messages.push(toolUseMsg(ids));
        messages.push(toolResultMsg(ids));
      } else {
        messages.push(textMsg('assistant', 'answer ' + i));
      }
    }
    assert.equal(assertValidAnthropicMessages(messages), true);

    const groups = groupSemanticExchanges(messages);
    const flattened = groups.flatMap((g) => g.messages);
    assert.equal(flattened.length, messages.length, 'grouping lost or duplicated messages');
    for (let i = 0; i < messages.length; i++) {
      assert.equal(flattened[i], messages[i], 'grouping reordered message ' + i);
    }
  });

  it('FG-F5: no group ever splits a tool_use from its result batch', () => {
    const messages = [
      textMsg('user', 'go'),
      toolUseMsg(['toolu_x']),
      toolResultMsg(['toolu_x']),
      textMsg('user', 'next'),
      textMsg('assistant', 'done'),
    ];
    const groups = groupSemanticExchanges(messages);
    for (const group of groups) {
      const uses = group.messages.flatMap((m) =>
        Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_use') : [],
      );
      const results = group.messages.flatMap((m) =>
        Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : [],
      );
      assert.equal(uses.length, results.length, 'a group separated a tool_use from its tool_result');
    }
  });
});

describe('FG-F session-ledger durability edges', () => {
  function makeSession() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-ledger-'));
    return path.join(tmp, 's.state.json');
  }

  it('FG-F6: a torn (partial-line) tail is skipped and appends continue with correct sequence', () => {
    const sessionPath = makeSession();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('turn_start', { n: 1 });
    ledger.append('turn_end', { n: 1 });
    ledger.close();

    // Simulate a crash mid-write: a JSON fragment with no trailing newline.
    fs.appendFileSync(ledgerPathForSession(sessionPath), '{"v":1,"seq":3,"type":"torn_wri');
    // The cursor sidecar still describes the pre-crash state; remove it so
    // restore exercises the full-scan path against the torn file.
    fs.rmSync(cursorPathForLedger(ledgerPathForSession(sessionPath)), { force: true });

    const reopened = new SessionLedger(sessionPath);
    assert.equal(reopened.lastSeq, 2, 'torn line must be skipped, not parsed or fatal');
    const ev = reopened.append('turn_start', { n: 2 });
    assert.equal(ev.seq, 3, 'sequence must continue after the torn tail');
    reopened.close();
    assert.deepEqual(
      new SessionLedger(sessionPath).detectGaps(),
      [],
      'recovered ledger must have no sequence gaps among parseable events',
    );
  });

  // HS-02 (KNOWN GAP, todo): after recovering past a torn tail, the next
  // append starts at the raw end of file — concatenating onto the torn
  // fragment, which makes BOTH records unparseable to readAll(). Sequence
  // numbering stays correct, but one recovered event is invisible to replay.
  // Fix shape: newline-terminate the file (or truncate the torn tail) before
  // the first post-recovery append. Flip to a hard assertion when fixed.
  it(
    'HS-02: the first append after a torn tail is readable by readAll()',
    { todo: 'known gap — post-recovery append concatenates onto the torn fragment' },
    () => {
      const sessionPath = makeSession();
      const ledger = new SessionLedger(sessionPath);
      ledger.append('turn_start', { n: 1 });
      ledger.close();
      fs.appendFileSync(ledgerPathForSession(sessionPath), '{"torn":tr');
      fs.rmSync(cursorPathForLedger(ledgerPathForSession(sessionPath)), { force: true });

      const reopened = new SessionLedger(sessionPath);
      reopened.append('turn_start', { n: 2 });
      reopened.close();
      const readable = reopened.readAll().map((e) => e.seq);
      assert.ok(readable.includes(2), 'post-recovery event must be replayable; got seqs ' + readable.join(','));
    },
  );

  it('FG-F7: a cursor sidecar pointing past end-of-file falls back to a full scan', () => {
    const sessionPath = makeSession();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('turn_start', { n: 1 });
    ledger.close();

    const cursorPath = cursorPathForLedger(ledgerPathForSession(sessionPath));
    fs.writeFileSync(cursorPath, JSON.stringify({ v: 1, seq: 99, offset: 1_000_000, pendingIntents: [] }) + '\n');

    const reopened = new SessionLedger(sessionPath);
    assert.equal(reopened.lastSeq, 1, 'corrupt cursor must not be trusted over the file');
    assert.equal(reopened.getCursor().source, 'scan', 'restore must report the scan fallback');
  });

  it('FG-F8: a cursor with the wrong schema version is ignored', () => {
    const sessionPath = makeSession();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('turn_start', { n: 1 });
    ledger.close();

    const cursorPath = cursorPathForLedger(ledgerPathForSession(sessionPath));
    fs.writeFileSync(cursorPath, JSON.stringify({ v: 999, seq: 42, offset: 0, pendingIntents: [] }) + '\n');
    const reopened = new SessionLedger(sessionPath);
    assert.equal(reopened.lastSeq, 1, 'future-versioned cursor must be ignored, not half-read');
  });

  it('FG-F9: unmatched intents survive a restart; matched intents are cleared', () => {
    // The write-ahead promise resume repair relies on: an intent with no
    // result is exactly what planRepair inspects after a crash.
    const sessionPath = makeSession();
    const ledger = new SessionLedger(sessionPath);
    ledger.append('write_intent', { effectId: 'fx_done' });
    ledger.append('write_result', { effectId: 'fx_done' });
    ledger.append('write_intent', { effectId: 'fx_pending' });
    ledger.close();

    // Remove the cursor to force the scan path — the scan and the cursor must
    // agree on pending intents, and the scan is the source of truth.
    fs.rmSync(cursorPathForLedger(ledgerPathForSession(sessionPath)), { force: true });
    const reopened = new SessionLedger(sessionPath);
    const pending = reopened.getPendingIntents().map((p) => p.id);
    assert.deepEqual(pending, ['fx_pending'], 'restart must reconstruct exactly the unmatched intents');
  });
});
