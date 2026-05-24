'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildToolSummarySection,
  invalidateContextCache,
  getCachedSystemPrompt,
  setCachedSystemPrompt,
  capSkillListing,
} = require('../../src/runner/context-budget');

describe('context budget', () => {
  it('builds one-line tool summaries without full schemas', () => {
    const section = buildToolSummarySection({ allowShell: false });
    assert.match(section, /read_file:/);
    assert.doesNotMatch(section, /input_schema/);
    assert.doesNotMatch(section, /\bbash:/);
  });

  it('memoizes and invalidates system prompt cache', () => {
    invalidateContextCache();
    const ctx = { cwd: '/tmp/x', allowShell: false, instructionHash: 'abc' };
    assert.equal(getCachedSystemPrompt(ctx), null);
    setCachedSystemPrompt(ctx, 'prompt v1');
    assert.equal(getCachedSystemPrompt(ctx), 'prompt v1');
    invalidateContextCache();
    assert.equal(getCachedSystemPrompt(ctx), null);
  });

  it('caps skill listing to budget fraction', () => {
    const listing = Array.from({ length: 200 }, (_, i) => 'skill-' + i + ' ' + 'x'.repeat(200)).join('\n');
    const capped = capSkillListing(listing, 32_000);
    assert.ok(capped.length < listing.length);
    assert.match(capped, /skills listing truncated|skill-/);
  });
});
