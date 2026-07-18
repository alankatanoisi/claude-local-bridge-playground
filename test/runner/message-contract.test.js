'use strict';

// These tests describe the Anthropic Messages invariant at the runner's final
// request boundary. A model may emit several tool calls in one assistant turn,
// and their local executions may finish in a different order. Order is not the
// contract: exact, one-to-one ID membership in the immediately following user
// tool-result batch is the contract.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MessageContractError,
  assertValidAnthropicMessages,
  groupSemanticExchanges,
} = require('../../src/runner/message-contract');
const { summarizeOldTurns } = require('../../src/runner/context-compactor');

function toolUse(id, name = 'read_file') {
  return { type: 'tool_use', id, name, input: { path: id + '.txt' } };
}

function toolResult(id, text = 'ok') {
  return { type: 'tool_result', tool_use_id: id, content: text };
}

describe('Anthropic message contract', () => {
  it('accepts a complete multi-tool batch even when results are not FIFO', () => {
    const messages = [
      { role: 'user', content: 'Inspect both files.' },
      { role: 'assistant', content: [toolUse('a'), toolUse('b'), toolUse('c')] },
      {
        role: 'user',
        // Parallel work is allowed to finish out of order. IDs, not array
        // position, establish the pairing.
        content: [toolResult('c'), toolResult('a'), toolResult('b')],
      },
      { role: 'user', content: 'A later instruction delta may be standalone.' },
    ];

    assert.doesNotThrow(() => assertValidAnthropicMessages(messages));
  });

  it('rejects orphaned, missing, duplicate, and misplaced tool results locally', () => {
    const cases = [
      {
        label: 'orphan',
        messages: [{ role: 'user', content: [toolResult('missing')] }],
      },
      {
        label: 'missing',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [toolUse('a'), toolUse('b')] },
          { role: 'user', content: [toolResult('a')] },
        ],
      },
      {
        label: 'duplicate',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [toolUse('a')] },
          { role: 'user', content: [toolResult('a'), toolResult('a')] },
        ],
      },
      {
        label: 'misplaced',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [toolUse('a')] },
          { role: 'user', content: [{ type: 'text', text: 'first' }, toolResult('a')] },
        ],
      },
    ];

    for (const fixture of cases) {
      assert.throws(
        () => assertValidAnthropicMessages(fixture.messages),
        (error) => error instanceof MessageContractError && error.code === 'invalid_anthropic_message_history',
        fixture.label,
      );
    }
  });

  it('keeps a prompt, assistant tool batch, and result batch in one semantic exchange', () => {
    const messages = [
      { role: 'user', content: 'first prompt' },
      { role: 'assistant', content: [toolUse('a'), toolUse('b')] },
      { role: 'user', content: [toolResult('b'), toolResult('a')] },
      { role: 'user', content: 'instruction delta' },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];

    const groups = groupSemanticExchanges(messages);
    assert.deepEqual(
      groups.map((group) => [group.start, group.end]),
      [
        [0, 3],
        [3, 5],
      ],
    );
  });

  it('reproduces the postmortem shape and preserves every retained batch after summarization', () => {
    const messages = [];
    for (let turn = 0; turn < 10; turn++) {
      messages.push({ role: 'user', content: 'question ' + turn });
      messages.push({ role: 'assistant', content: [toolUse('a' + turn), toolUse('b' + turn)] });
      messages.push({ role: 'user', content: [toolResult('b' + turn), toolResult('a' + turn)] });
    }

    // The standalone update made the old raw message-count cutoff odd, which
    // is the exact kind of shape that exposed the July 11 pairing defect.
    messages.push({ role: 'user', content: 'instruction delta after completed tool batch' });

    const compacted = summarizeOldTurns(messages, 2);
    assert.equal(compacted.changed, true);
    assert.doesNotThrow(() => assertValidAnthropicMessages(compacted.messages));

    // Applying the same transform again may summarize more prose, but it must
    // never invent, duplicate, or orphan a tool ID.
    const compactedAgain = summarizeOldTurns(compacted.messages, 2);
    assert.doesNotThrow(() => assertValidAnthropicMessages(compactedAgain.messages));
  });

  it('rejects whitespace-only tool ids as a local contract failure', () => {
    assert.throws(
      () =>
        assertValidAnthropicMessages([
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [{ type: 'tool_use', id: '  ', name: 'read_file', input: {} }] },
          { role: 'user', content: [toolResult('  ')] },
        ]),
      (error) => error instanceof MessageContractError,
    );
  });
});
