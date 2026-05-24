'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeOldTurns, applyCompactionLadder } = require('../../src/runner/context-compactor');

describe('reactive compaction', () => {
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
});
