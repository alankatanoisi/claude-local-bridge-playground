'use strict';

/**
 * Model-aware request controls for effort and adaptive thinking.
 *
 * Why this file exists:
 * Anthropic model IDs still pass through unchanged, so the upstream API remains
 * the source of truth for new models. However, known model families have
 * meaningfully different effort/thinking rules. Catching known mismatches here
 * gives the user a clear local error instead of spending a request on a 400.
 *
 * P1-07: the rules now come from the single versioned catalog in
 * `model-catalog.js` (shared with pricing and the default-model constant),
 * `--effort auto` is a runner-local reset sentinel that omits the field, and
 * unknown models produce an explicit warning instead of silent permissiveness.
 */

const {
  CATALOG_VERSION,
  EFFORT_LEVELS,
  EFFORT_AUTO,
  THINKING_MODES,
  catalogEntryForModel,
} = require('./model-catalog');

function normalizeEffort(effort) {
  if (!effort) return null;
  const level = String(effort).toLowerCase();
  // 'auto' is runner-local: it means "send no output_config.effort at all" and
  // is never forwarded upstream (the API has no such value).
  if (level === EFFORT_AUTO) return null;
  if (!EFFORT_LEVELS.includes(level)) {
    throw new Error('--effort must be one of: ' + EFFORT_AUTO + ', ' + EFFORT_LEVELS.join(', '));
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
  const known = catalogEntryForModel(model);

  // Unknown/future model IDs remain permissive so new releases work day one.
  // But permissiveness is REPORTED (known: false + catalogVersion), never
  // silent — the caller surfaces a warning that local validation was skipped.
  return known
    ? { ...known, known: true, catalogVersion: CATALOG_VERSION }
    : {
        label: 'unknown or future model',
        effortLevels: EFFORT_LEVELS,
        thinking: 'unknown',
        known: false,
        catalogVersion: CATALOG_VERSION,
      };
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
 * Returns warnings (e.g. unknown model → validation skipped) so callers can
 * surface them; nothing here is allowed to fall back silently.
 */
function resolveModelControls({ model, effort, thinking } = {}) {
  const normalizedEffort = normalizeEffort(effort);
  const thinkingMode = normalizeThinkingMode(thinking);
  const capability = capabilityForModel(model);

  validateEffortForModel(model, normalizedEffort, capability);

  const warnings = [];
  if (!capability.known) {
    warnings.push(
      "Model '" +
        model +
        "' is not in the local capability catalog (version " +
        CATALOG_VERSION +
        '); effort/thinking are forwarded without local validation — the API may reject unsupported combinations.',
    );
  }

  return {
    effort: normalizedEffort,
    thinkingMode,
    thinkingConfig: thinkingConfigForModel(model, thinkingMode, capability),
    capability,
    warnings,
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
