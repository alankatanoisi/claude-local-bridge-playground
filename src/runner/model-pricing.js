'use strict';

/**
 * Model pricing table — estimate only, for budget warnings and usage summaries.
 *
 * Rates are USD per million tokens. Cache rates follow Anthropic's public
 * multipliers for the 1-hour TTL the runner pins (see RUNNER_CACHE_CONTROL in
 * run.js): cache writes (creation) are 2.0x base input, cache reads are 0.1x
 * base input.
 */

// P1-07: rates now come from the single versioned catalog (model-catalog.js)
// so pricing, capabilities, and defaults cannot drift independently. Lookup
// order: exact catalog entry, then family estimate, then generic default —
// and the source of the number is always reported, never silent.
const { pricingForModel, catalogEntryForModel, CATALOG_VERSION, DEFAULT_PRICING } = require('./model-catalog');

// Back-compat shape for existing consumers/tests that index by model key.
const PRICING_PER_MILLION = Object.freeze({
  'claude-sonnet-4-6': catalogEntryForModel('claude-sonnet-4-6').pricing,
  'claude-opus-4-6': catalogEntryForModel('claude-opus-4-6').pricing,
  'claude-haiku-4-5': catalogEntryForModel('claude-haiku-4-5').pricing,
  default: DEFAULT_PRICING,
});

function resolveRates(model) {
  return pricingForModel(model).rates;
}

/** Rates plus provenance ('catalog' | 'family-estimate' | 'default-estimate'). */
function resolveRatesDetailed(model) {
  return { ...pricingForModel(model), catalogVersion: CATALOG_VERSION };
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
  // P1-07: say where the rate came from so estimates are never mistaken for
  // published per-model rates ('catalog' | 'family-estimate' | 'default-estimate').
  const pricingSource = pricingForModel(model).source;

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
    pricingSource,
    oneLine,
  };
}

module.exports = {
  PRICING_PER_MILLION,
  resolveRates,
  resolveRatesDetailed,
  estimateCostUsd,
  summarizeUsage,
};
