'use strict';

const { CATALOG_VERSION, catalogEntryForModel } = require('./model-catalog');

const UNKNOWN_CONTEXT_WINDOW = 200_000;
const DEFAULT_PROTECTED_EXCHANGES = 8;
const DEFAULT_EMERGENCY_RESULT_CHARS = 200_000;

function normalizedThresholds(ceiling) {
  // These floors keep the tiers meaningful even for a small remaining window.
  const observe = Math.max(1_000, Math.min(100_000, Math.floor(ceiling * 0.5)));
  const compact = Math.max(observe + 1_000, Math.min(150_000, Math.floor(ceiling * 0.75)));
  const checkpoint = Math.max(compact + 1_000, Math.min(250_000, Math.floor(ceiling * 0.9)));
  return {
    observe: Math.min(observe, ceiling - 3),
    compact: Math.min(compact, ceiling - 2),
    checkpoint: Math.min(checkpoint, ceiling - 1),
  };
}

function deriveContextPolicy({ model, maxTokens, compactAtTokens }) {
  const entry = catalogEntryForModel(model);
  const contextWindow = entry?.contextWindow || UNKNOWN_CONTEXT_WINDOW;
  const maxOutputTokens = entry?.maxOutputTokens || null;
  const requestedOutputTokens = Number(maxTokens);
  if (!Number.isFinite(requestedOutputTokens) || requestedOutputTokens <= 0) {
    throw new Error('--max-tokens must be a positive response-output token allowance.');
  }
  if (maxOutputTokens && requestedOutputTokens > maxOutputTokens) {
    throw new Error(
      '--max-tokens ' +
        requestedOutputTokens +
        ' exceeds the selected model maximum response output of ' +
        maxOutputTokens +
        '.',
    );
  }
  const safetyMargin = Math.max(10_000, Math.ceil(contextWindow * 0.01));
  const inputCeiling = contextWindow - requestedOutputTokens - safetyMargin;
  if (inputCeiling <= 3_000) {
    throw new Error('The requested response output leaves no safe input context. Lower --max-tokens.');
  }
  const tiers = normalizedThresholds(inputCeiling);
  if (compactAtTokens !== undefined) {
    const override = Number(compactAtTokens);
    if (!Number.isFinite(override) || override <= 0 || override >= tiers.checkpoint) {
      throw new Error(
        '--compact-at-tokens must be positive and lower than the durable-checkpoint threshold (' +
          tiers.checkpoint +
          ').',
      );
    }
    tiers.compact = Math.floor(override);
    tiers.observe = Math.max(1_000, Math.min(tiers.observe, Math.floor(tiers.compact * 0.75)));
    if (tiers.compact >= tiers.checkpoint) {
      throw new Error('--compact-at-tokens leaves no room before the durable-checkpoint threshold.');
    }
  }
  return {
    catalogVersion: CATALOG_VERSION,
    source: entry ? entry.provenance : 'estimated-unknown-model',
    limitsEstimated: !entry,
    contextWindow,
    maxOutputTokens,
    requestedOutputTokens,
    safetyMargin,
    inputCeiling,
    ...tiers,
    protectedExchanges: DEFAULT_PROTECTED_EXCHANGES,
    emergencyResultChars: DEFAULT_EMERGENCY_RESULT_CHARS,
  };
}

function pressureTier(tokens, policy) {
  if (tokens >= policy.inputCeiling) return 'ceiling';
  if (tokens >= policy.checkpoint) return 'checkpoint';
  if (tokens >= policy.compact) return 'compact';
  if (tokens >= policy.observe) return 'observe';
  return 'normal';
}

module.exports = {
  UNKNOWN_CONTEXT_WINDOW,
  DEFAULT_PROTECTED_EXCHANGES,
  DEFAULT_EMERGENCY_RESULT_CHARS,
  deriveContextPolicy,
  pressureTier,
};
