'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseSelection, formatOptions } = require('../../src/runner/user-question');
const askUserQuestionTool = require('../../src/runner/tools/ask-user-question');

describe('ask_user_question helpers', () => {
  const options = [
    { label: 'Keep', description: 'Leave behavior unchanged' },
    { label: 'Change', description: 'Apply the new approach' },
  ];

  it('formats numbered options', () => {
    const text = formatOptions(options);
    assert.ok(text.includes('1) Keep'));
    assert.ok(text.includes('2) Change'));
  });

  it('parses numeric selection', () => {
    assert.deepEqual(parseSelection('2', options, false), ['Change']);
  });

  it('parses label selection', () => {
    assert.deepEqual(parseSelection('keep', options, false), ['Keep']);
  });

  it('rejects invalid selection', () => {
    assert.equal(parseSelection('9', options, false), null);
  });
});

describe('ask_user_question tool gates', () => {
  const baseArgs = {
    question: 'Proceed?',
    options: [{ label: 'Yes' }, { label: 'No' }],
  };

  it('fails closed under --dont-ask', async () => {
    const result = await askUserQuestionTool.execute(baseArgs, { dontAsk: true });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('dont-ask'));
  });

  it('fails closed in plan mode', async () => {
    const result = await askUserQuestionTool.execute(baseArgs, { plan: true });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Plan mode'));
  });

  it('fails closed in child workers', async () => {
    const result = await askUserQuestionTool.execute(baseArgs, { spawnDepth: 1 });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('child agent'));
  });

  it('fails closed without interactive terminal', async () => {
    // The invariant is "no TTY → fail closed", so the test must FORCE that
    // condition instead of assuming the suite was launched without a TTY.
    // Unforced, this test's result depended on how npm test was started:
    // piped/CI (no TTY) → instant pass; a real interactive Terminal → the tool
    // opened an actual prompt and blocked waiting for a human, failing only
    // after a multi-minute timeout. Same commit, opposite results, neither one
    // a fact about the product.
    const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const result = await askUserQuestionTool.execute(baseArgs, {});
      assert.equal(result.ok, false);
      assert.ok(result.text.includes('interactive terminal'));
    } finally {
      if (original) Object.defineProperty(process.stdin, 'isTTY', original);
      else delete process.stdin.isTTY;
    }
  });
});
