'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { estimateCostUsd, summarizeUsage, resolveRates } = require('../../src/runner/model-pricing');

const M = 1_000_000;

describe('model-pricing: estimateCostUsd', () => {
  it('prices input + output (regression, no cache tokens)', () => {
    // sonnet: 1M input @ $3 + 1M output @ $15 = $18.00
    const cost = estimateCostUsd('claude-sonnet-4-6', { input_tokens: M, output_tokens: M });
    assert.equal(cost, 18.0);
  });

  it('prices cache_read and cache_write as separate components', () => {
    // sonnet cache_read 0.1x input = $0.30/M, cache_write (1h) 2.0x input = $6.00/M
    const readCost = estimateCostUsd('claude-sonnet-4-6', { cache_read_input_tokens: M });
    assert.ok(Math.abs(readCost - 0.3) < 1e-9);
    const writeCost = estimateCostUsd('claude-sonnet-4-6', { cache_creation_input_tokens: M });
    assert.ok(Math.abs(writeCost - 6.0) < 1e-9);
  });

  it('sums all four components without double counting', () => {
    const cost = estimateCostUsd('claude-sonnet-4-6', {
      input_tokens: M,
      output_tokens: M,
      cache_read_input_tokens: M,
      cache_creation_input_tokens: M,
    });
    assert.ok(Math.abs(cost - (3.0 + 15.0 + 0.3 + 6.0)) < 1e-9);
  });

  it('falls back to default for an unknown model', () => {
    const cost = estimateCostUsd('totally-unknown-model', { input_tokens: M });
    assert.equal(cost, 3.0); // default input rate
  });

  it('resolves new/alias names by family prefix, not default', () => {
    // A future opus alias should price like opus ($15/M input), not default ($3/M).
    assert.equal(resolveRates('claude-opus-4-8'), resolveRates('claude-opus-4-6'));
    const cost = estimateCostUsd('claude-opus-4-8', { input_tokens: M });
    assert.equal(cost, 15.0);
  });
});

describe('model-pricing: summarizeUsage', () => {
  it('exposes raw counts and derived fields', () => {
    const s = summarizeUsage('claude-sonnet-4-6', {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 0,
    });
    assert.equal(s.inputTokens, 100);
    assert.equal(s.outputTokens, 50);
    assert.equal(s.cacheReadTokens, 300);
    assert.equal(s.cacheCreationTokens, 0);
    assert.equal(s.totalInputTokens, 400);
    // cache read share = 300 / (100 + 300 + 0) = 0.75
    assert.ok(Math.abs(s.cacheReadShare - 0.75) < 1e-9);
    assert.ok(s.costUsd > 0);
  });

  it('cacheReadShare is 0 when there are no prompt tokens', () => {
    const s = summarizeUsage('claude-sonnet-4-6', { output_tokens: 10 });
    assert.equal(s.cacheReadShare, 0);
  });

  it('oneLine omits zero cache fields and includes a dollar estimate', () => {
    const s = summarizeUsage('claude-sonnet-4-6', { input_tokens: 100, output_tokens: 50 });
    assert.ok(s.oneLine.includes('in=100'));
    assert.ok(s.oneLine.includes('out=50'));
    assert.ok(!s.oneLine.includes('cache_read='));
    assert.ok(!s.oneLine.includes('cache_write='));
    assert.ok(s.oneLine.includes('~$'));
    assert.ok(/reuse \d+%/.test(s.oneLine));
  });

  it('oneLine shows cache fields when present', () => {
    const s = summarizeUsage('claude-sonnet-4-6', {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 200,
    });
    assert.ok(s.oneLine.includes('cache_read=300'));
    assert.ok(s.oneLine.includes('cache_write=200'));
  });
});
