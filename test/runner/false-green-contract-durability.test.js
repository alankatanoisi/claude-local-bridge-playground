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

  // HS-02: keep the cursor sidecar on purpose. A real crash can write bytes to
  // the ledger and die before updating that sidecar, so recovery must notice
  // that the cursor is stale before deciding the next sequence number.
  it('HS-02: the first append after a partial JSON tail is readable and monotonic', () => {
    const sessionPath = makeSession();
    const ledgerPath = ledgerPathForSession(sessionPath);
    const ledger = new SessionLedger(sessionPath);
    ledger.append('turn_start', { n: 1 });
    ledger.close();

    // This fragment represents a process dying partway through one write. It
    // has no newline, so appending directly would glue the next event to it.
    fs.appendFileSync(ledgerPath, '{"v":1,"seq":2,"type":"torn_wri');

    const reopened = new SessionLedger(sessionPath);
    assert.equal(reopened.getCursor().source, 'scan', 'bytes after a stale cursor must be scanned');
    const recoveredEvent = reopened.append('turn_start', { n: 2 });
    reopened.close();

    const readable = reopened.readAll();
    assert.equal(recoveredEvent.seq, 2, 'an unreadable partial event does not consume a sequence number');
    assert.deepEqual(
      readable.map((event) => event.seq),
      [1, 2],
      'the recovered append must be readable without a gap or duplicate sequence',
    );
    assert.deepEqual(reopened.detectGaps(), [], 'parseable events remain strictly monotonic');
  });

  it('HS-02: a complete record missing only its newline survives stale-cursor recovery', () => {
    const sessionPath = makeSession();
    const ledgerPath = ledgerPathForSession(sessionPath);
    const ledger = new SessionLedger(sessionPath);
    ledger.append('turn_start', { n: 1 });
    ledger.close();

    // JSONL normally ends every record with "\n". This record is valid JSON,
    // but the process died before its newline and cursor update were durable.
    const completeButUnterminated = {
      v: 1,
      seq: 2,
      ts: new Date().toISOString(),
      type: 'turn_end',
      n: 1,
    };
    fs.appendFileSync(ledgerPath, JSON.stringify(completeButUnterminated));

    const reopened = new SessionLedger(sessionPath);
    assert.equal(reopened.lastSeq, 2, 'the complete record after the stale cursor must count');
    const recoveredEvent = reopened.append('turn_start', { n: 2 });
    reopened.close();

    assert.equal(recoveredEvent.seq, 3, 'the next event must not duplicate the complete record sequence');
    assert.deepEqual(
      reopened.readAll().map((event) => event.seq),
      [1, 2, 3],
      'all complete records remain readable after the delimiter is added',
    );
    assert.deepEqual(reopened.detectGaps(), [], 'valid unterminated recovery remains strictly monotonic');
  });

  it('HS-02: stale-cursor scanning reconstructs pending intents before a torn-tail result append', () => {
    const sessionPath = makeSession();
    const ledgerPath = ledgerPathForSession(sessionPath);
    const ledger = new SessionLedger(sessionPath);
    ledger.append('turn_start', { n: 1 });
    ledger.close();

    // The cursor still points to seq 1. A complete intent reached the ledger
    // afterward, followed by an incomplete third record. Recovery must scan
    // both pieces, retain the intent, and safely reuse seq 3 for its result.
    const intent = {
      v: 1,
      seq: 2,
      ts: new Date().toISOString(),
      type: 'write_intent',
      effectId: 'fx_after_stale_cursor',
    };
    fs.appendFileSync(ledgerPath, JSON.stringify(intent) + '\n{"v":1,"seq":3,"type":"torn');

    const reopened = new SessionLedger(sessionPath);
    assert.deepEqual(
      reopened.getPendingIntents().map((pending) => pending.id),
      ['fx_after_stale_cursor'],
      'full-scan fallback must reconstruct the intent written after the cursor',
    );
    const result = reopened.append('write_result', {
      effectId: 'fx_after_stale_cursor',
      ok: true,
    });
    reopened.close();

    assert.equal(result.seq, 3, 'the unreadable partial record does not consume seq 3');
    assert.deepEqual(reopened.getPendingIntents(), [], 'the recovered result closes the recovered intent');
    assert.deepEqual(
      reopened.readAll().map((event) => event.seq),
      [1, 2, 3],
      'the intent and its post-recovery result both remain replayable',
    );
    assert.deepEqual(reopened.detectGaps(), [], 'intent/result recovery remains strictly monotonic');
  });

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
