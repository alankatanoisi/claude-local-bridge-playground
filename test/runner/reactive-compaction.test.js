'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeOldTurns, applyCompactionLadder } = require('../../src/runner/context-compactor');

describe('reactive compaction', () => {
  function toolTurn(id, content) {
    return [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'read_file', input: { path: 'a.txt' } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content }],
      },
    ];
  }

  it('summarizeOldTurns preserves recent turns and pairs', () => {
    const messages = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: 'question ' + i });
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't' + i, name: 'read_file', input: {} }],
      });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't' + i, content: 'result ' + i }],
      });
    }
    const { messages: out, changed, stage } = summarizeOldTurns(messages, 2);
    assert.equal(changed, true);
    assert.equal(stage, 'summarize');
    assert.ok(out.length < messages.length);
    assert.match(String(out[0].content), /compaction:summarize/);
    const tailHasPair = out.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result' && b.tool_use_id === 't9'),
    );
    assert.equal(tailHasPair, true);
  });

  it('applyCompactionLadder runs summarize at halt threshold', () => {
    const messages = [];
    for (let i = 0; i < 50; i++) {
      messages.push({ role: 'user', content: 'msg ' + i + ' ' + 'y'.repeat(500) });
      messages.push({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] });
    }
    const r = applyCompactionLadder(messages, 'sys', { warnTokens: 100, haltTokens: 200, ghostAfterMessages: 5 });
    assert.ok(r.stagesApplied.includes('summarize') || r.stagesApplied.includes('ghost'));
  });

  it('does not snip just because message count is high when token pressure is low', () => {
    const messages = [{ role: 'user', content: 'start' }];
    for (let i = 0; i < 8; i++) messages.push(...toolTurn('t' + i, 'small result ' + i));

    const r = applyCompactionLadder(messages, 'sys', {
      warnTokens: 80_000,
      haltTokens: 160_000,
      snipAfterMessages: 4,
      ghostAfterMessages: 6,
      maxToolResultChars: 12_000,
    });

    assert.deepEqual(r.stagesApplied, []);
    assert.equal(r.changed, false);
  });

  it('still allows explicit message-count snipping for compact modes', () => {
    const messages = [{ role: 'user', content: 'start' }];
    for (let i = 0; i < 8; i++) messages.push(...toolTurn('t' + i, 'snippable result ' + i + ' ' + 'x'.repeat(220)));

    const r = applyCompactionLadder(messages, 'sys', {
      warnTokens: 80_000,
      haltTokens: 160_000,
      snipAfterMessages: 4,
      ghostAfterMessages: 6,
      preserveRecentTurns: 1,
      snipOnMessageCount: true,
      ghostOnMessageCount: true,
    });

    assert.ok(r.stagesApplied.includes('snip'));
    assert.ok(r.stagesApplied.includes('ghost'));
  });
});
