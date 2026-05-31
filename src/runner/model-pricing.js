'use strict';

/**
 * Model pricing table — estimate only, for budget warnings and usage summaries.
 *
 * Rates are USD per million tokens. Cache rates follow Anthropic's public
 * multipliers for the 1-hour TTL the runner pins (see RUNNER_CACHE_CONTROL in
 * run.js): cache writes (creation) are 2.0x base input, cache reads are 0.1x
 * base input.
 */

const PRICING_PER_MILLION = Object.freeze({
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 6.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0, cache_read: 1.5, cache_write: 30.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0, cache_read: 0.08, cache_write: 1.6 },
  default: { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 6.0 },
});

// Resolve rates defensively so new/alias model names (e.g. a future
// claude-opus-4-8) fall back to the right family instead of silently using the
// generic default. Lookup order: exact key, then family prefix, then default.
const FAMILY_PREFIXES = [
  { prefix: 'claude-opus', key: 'claude-opus-4-6' },
  { prefix: 'claude-sonnet', key: 'claude-sonnet-4-6' },
  { prefix: 'claude-haiku', key: 'claude-haiku-4-5' },
];

function resolveRates(model) {
  if (model && PRICING_PER_MILLION[model]) return PRICING_PER_MILLION[model];
  if (typeof model === 'string') {
    for (const { prefix, key } of FAMILY_PREFIXES) {
      if (model.startsWith(prefix)) return PRICING_PER_MILLION[key];
    }
  }
  return PRICING_PER_MILLION.default;
}

function estimateCostUsd(model, usage) {
  const rates = resolveRates(model);
  const u = usage || {};
  // The Messages API reports cache_read_input_tokens and
  // cache_creation_input_tokens SEPARATELY from input_tokens (they are not
  // included in it), so summing all four components is correct — no double count.
  const input = (u.input_tokens || 0) / 1_000_000;
  const output = (u.output_tokens || 0) / 1_000_000;
  const cacheRead = (u.cache_read_input_tokens || 0) / 1_000_000;
  const cacheWrite = (u.cache_creation_input_tokens || 0) / 1_000_000;
  return input * rates.input + output * rates.output + cacheRead * rates.cache_read + cacheWrite * rates.cache_write;
}

/**
 * Build a usage/cost summary for stderr, transcript, and human-log surfaces.
 *
 * Returns both raw token counts and derived fields so downstream scripts never
 * have to parse the display string.
 *
 * cacheReadShare is the fraction of prompt tokens served from cache. It is
 * deliberately named "read share" rather than "hit rate" — it measures reuse,
 * not a true cache hit rate.
 */
function summarizeUsage(model, usage) {
  const u = usage || {};
  const inputTokens = u.input_tokens || 0;
  const outputTokens = u.output_tokens || 0;
  const cacheReadTokens = u.cache_read_input_tokens || 0;
  const cacheCreationTokens = u.cache_creation_input_tokens || 0;
  const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
  const costUsd = estimateCostUsd(model, u);
  const cacheReadShare = totalInputTokens > 0 ? cacheReadTokens / totalInputTokens : 0;

  const parts = ['in=' + inputTokens, 'out=' + outputTokens];
  if (cacheReadTokens) parts.push('cache_read=' + cacheReadTokens);
  if (cacheCreationTokens) parts.push('cache_write=' + cacheCreationTokens);
  parts.push('(reuse ' + Math.round(cacheReadShare * 100) + '%)');
  parts.push('~$' + costUsd.toFixed(4));
  const oneLine = '[runner usage] ' + parts.join(' ');

  return {
    model: model || null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalInputTokens,
    costUsd,
    cacheReadShare,
    oneLine,
  };
}

module.exports = {
  PRICING_PER_MILLION,
  resolveRates,
  estimateCostUsd,
  summarizeUsage,
};
