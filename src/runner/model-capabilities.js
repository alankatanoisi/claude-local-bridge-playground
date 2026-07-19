'use strict';

/**
 * Model-aware request controls for effort and adaptive thinking.
 *
 * Why this file exists:
 * Anthropic model IDs still pass through unchanged, so the upstream API remains
 * the source of truth for new models. However, a few known model families have
 * meaningfully different thinking rules. Catching those known mismatches here
 * gives the user a clear local error instead of spending a request on a 400.
 */

const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const THINKING_MODES = Object.freeze(['auto', 'adaptive', 'off']);

const STANDARD_EFFORT = Object.freeze(['low', 'medium', 'high', 'max']);
const XHIGH_EFFORT = EFFORT_LEVELS;

/**
 * Each rule describes only behavior that is stable and useful for request
 * validation. Date-suffixed model IDs still match because every expression
 * accepts either the end of the ID or another hyphen after the family name.
 */
const MODEL_RULES = Object.freeze([
  {
    matches: /^claude-(?:fable|mythos)-5(?:$|-)/,
    label: 'Claude Fable/Mythos 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'always-on',
  },
  {
    matches: /^claude-mythos-preview(?:$|-)/,
    label: 'Claude Mythos Preview',
    effortLevels: STANDARD_EFFORT,
    thinking: 'always-on',
  },
  {
    matches: /^claude-sonnet-5(?:$|-)/,
    label: 'Claude Sonnet 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'default-on',
  },
  {
    matches: /^claude-opus-4-(?:8|7)(?:$|-)/,
    label: 'Claude Opus 4.7/4.8',
    effortLevels: XHIGH_EFFORT,
    thinking: 'explicit-adaptive',
  },
  {
    matches: /^claude-(?:opus|sonnet)-4-6(?:$|-)/,
    label: 'Claude Opus/Sonnet 4.6',
    effortLevels: STANDARD_EFFORT,
    thinking: 'explicit-adaptive',
  },
  {
    matches: /^claude-opus-4-5(?:$|-)/,
    label: 'Claude Opus 4.5',
    effortLevels: STANDARD_EFFORT,
    thinking: 'manual-only',
  },
  {
    matches: /^claude-(?:sonnet|haiku)-4-5(?:$|-)|^claude-3(?:$|-)/,
    label: 'legacy Claude model',
    effortLevels: null,
    thinking: 'manual-or-none',
  },
]);

function normalizeEffort(effort) {
  if (!effort) return null;
  const level = String(effort).toLowerCase();
  if (!EFFORT_LEVELS.includes(level)) {
    throw new Error('--effort must be one of: ' + EFFORT_LEVELS.join(', '));
  }
  return level;
}

function normalizeThinkingMode(thinking) {
  const mode = thinking ? String(thinking).toLowerCase() : 'auto';
  if (!THINKING_MODES.includes(mode)) {
    throw new Error('--thinking must be one of: ' + THINKING_MODES.join(', '));
  }
  return mode;
}

function capabilityForModel(model) {
  const modelId = String(model || '').toLowerCase();
  const known = MODEL_RULES.find((rule) => rule.matches.test(modelId));

  // Unknown/future model IDs remain permissive. An explicit adaptive request is
  // forwarded, while auto/off avoid inventing a model capability we do not know.
  return (
    known || {
      label: 'unknown or future model',
      effortLevels: EFFORT_LEVELS,
      thinking: 'unknown',
    }
  );
}

function validateEffortForModel(model, effort, capability) {
  if (!effort) return;

  if (!capability.effortLevels) {
    throw new Error("--effort is not supported by known model '" + model + "'");
  }

  if (!capability.effortLevels.includes(effort)) {
    throw new Error(
      '--effort ' +
        effort +
        " is not supported by model '" +
        model +
        "'. Supported levels: " +
        capability.effortLevels.join(', '),
    );
  }
}

/**
 * Convert the friendly runner mode into the exact Anthropic request field.
 * Returning null deliberately omits `thinking` from the JSON request.
 */
function thinkingConfigForModel(model, mode, capability) {
  switch (capability.thinking) {
    case 'always-on':
      if (mode === 'off') {
        throw new Error("--thinking off is not supported by model '" + model + "'; adaptive thinking is always on");
      }
      return null;

    case 'default-on':
      return mode === 'off' ? { type: 'disabled' } : null;

    case 'explicit-adaptive':
      return mode === 'off' ? null : { type: 'adaptive' };

    case 'manual-only':
    case 'manual-or-none':
      if (mode === 'adaptive') {
        throw new Error("--thinking adaptive is not supported by known model '" + model + "'");
      }
      return null;

    default:
      return mode === 'adaptive' ? { type: 'adaptive' } : null;
  }
}

/**
 * Resolve and validate both controls together before a model request is built.
 */
function resolveModelControls({ model, effort, thinking } = {}) {
  const normalizedEffort = normalizeEffort(effort);
  const thinkingMode = normalizeThinkingMode(thinking);
  const capability = capabilityForModel(model);

  validateEffortForModel(model, normalizedEffort, capability);

  return {
    effort: normalizedEffort,
    thinkingMode,
    thinkingConfig: thinkingConfigForModel(model, thinkingMode, capability),
  };
}

module.exports = {
  EFFORT_LEVELS,
  THINKING_MODES,
  capabilityForModel,
  normalizeEffort,
  normalizeThinkingMode,
  resolveModelControls,
};
