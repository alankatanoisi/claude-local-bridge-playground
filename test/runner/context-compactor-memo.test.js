'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateTokens } = require('../../src/runner/context-compactor');

describe('estimateTokens memoization', () => {
  it('is idempotent across repeated calls', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ack' },
          { type: 'tool_use', name: 'read_file', input: { path: '/etc/hosts', limit: 200 } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', content: 'x'.repeat(10_000) }],
      },
    ];
    const first = estimateTokens(messages);
    const second = estimateTokens(messages);
    const third = estimateTokens(messages);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.ok(first > 0);
  });

  it('recomputes for a newly constructed block with identical content', () => {
    const blockA = { type: 'text', text: 'aaaaa' };
    const blockB = { type: 'text', text: 'aaaaa' };
    const t1 = estimateTokens([{ role: 'user', content: [blockA] }]);
    const t2 = estimateTokens([{ role: 'user', content: [blockB] }]);
    assert.equal(t1, t2, 'identical content → identical estimate');
  });

  it('handles string content without crashing', () => {
    const t = estimateTokens([{ role: 'user', content: 'just a string' }]);
    assert.ok(t > 0);
  });
});
