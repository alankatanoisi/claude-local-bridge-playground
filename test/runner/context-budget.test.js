'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildToolSummarySection,
  invalidateContextCache,
  invalidateDynamicOnly,
  getCachedSystemPrompt,
  setCachedSystemPrompt,
  getCachedDynamicTail,
  setCachedDynamicTail,
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

  it('static cache survives compactionGeneration bumps (A3)', () => {
    invalidateContextCache();
    const base = { cwd: '/tmp/y', allowShell: false, instructionHash: 'h1' };
    setCachedSystemPrompt({ ...base, compactionGeneration: 0 }, 'p-static');
    assert.equal(getCachedSystemPrompt({ ...base, compactionGeneration: 0 }), 'p-static');
    // generation bumps must not invalidate static slice
    assert.equal(getCachedSystemPrompt({ ...base, compactionGeneration: 1 }), 'p-static');
    assert.equal(getCachedSystemPrompt({ ...base, compactionGeneration: 99 }), 'p-static');
  });

  it('static cache misses when tool registry shape changes (A3)', () => {
    invalidateContextCache();
    const base = { cwd: '/tmp/z', instructionHash: 'h2' };
    setCachedSystemPrompt({ ...base, allowShell: false }, 'p-noshell');
    assert.equal(getCachedSystemPrompt({ ...base, allowShell: false }), 'p-noshell');
    assert.equal(getCachedSystemPrompt({ ...base, allowShell: true }), null, 'allowShell flip changes toolRegistryHash');
  });

  it('invalidateDynamicOnly preserves the static slice (A3)', () => {
    invalidateContextCache();
    const ctx = { cwd: '/tmp/q', allowShell: false, instructionHash: 'h3', compactionGeneration: 5 };
    setCachedSystemPrompt(ctx, 'p-static');
    setCachedDynamicTail(ctx, 'tail-v5');
    assert.equal(getCachedDynamicTail(ctx), 'tail-v5');
    invalidateDynamicOnly();
    assert.equal(getCachedDynamicTail(ctx), null, 'dynamic tail cleared');
    assert.equal(getCachedSystemPrompt(ctx), 'p-static', 'static slice preserved');
  });

  it('caps skill listing to budget fraction', () => {
    const listing = Array.from({ length: 200 }, (_, i) => 'skill-' + i + ' ' + 'x'.repeat(200)).join('\n');
    const capped = capSkillListing(listing, 32_000);
    assert.ok(capped.length < listing.length);
    assert.match(capped, /skills listing truncated|skill-/);
  });
});
