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
    const result = await askUserQuestionTool.execute(baseArgs, {});
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('interactive terminal'));
  });
});
