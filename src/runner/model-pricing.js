'use strict';

/**
 * Model pricing table — estimate only, for budget warnings.
 */

const PRICING_PER_MILLION = Object.freeze({
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  default: { input: 3.0, output: 15.0 },
});

function estimateCostUsd(model, usage) {
  const rates = PRICING_PER_MILLION[model] || PRICING_PER_MILLION.default;
  const input = (usage.input_tokens || 0) / 1_000_000;
  const output = (usage.output_tokens || 0) / 1_000_000;
  return input * rates.input + output * rates.output;
}

module.exports = {
  PRICING_PER_MILLION,
  estimateCostUsd,
};
