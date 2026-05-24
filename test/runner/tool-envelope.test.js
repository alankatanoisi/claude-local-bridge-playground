'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeToolResult, resolveToolName } = require('../../src/runner/tool-envelope');

describe('tool envelope', () => {
  it('includes recovery pointer in model-visible text when truncated', () => {
    const env = normalizeToolResult({ ok: true, text: 'abc', truncated: true }, { bytes: 100, offset: 100 });
    assert.match(env.text, /truncated|read_file|offset/i);
  });

  it('resolves tool aliases to canonical names', () => {
    assert.equal(resolveToolName('read').canonical, 'read_file');
    assert.equal(resolveToolName('write').canonical, 'write_file');
    assert.equal(resolveToolName('read_file').aliasUsed, null);
  });
});
