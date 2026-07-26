'use strict';

// This is deliberately a request estimator, not a tokenizer. It measures every
// model-visible request surface with one deterministic algorithm, then lets
// observed Anthropic usage calibrate the result for each model.

const crypto = require('crypto');

const INITIAL_CALIBRATION_FACTOR = 1.5;
const CALIBRATION_ALPHA = 0.3;
const CALIBRATION_MIN = 0.75;
const CALIBRATION_MAX = 3;
const CHARS_PER_TOKEN = 4;

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 16);
}

function estimateRequest(request, calibrationFactor = INITIAL_CALIBRATION_FACTOR) {
  const serialized = stableJson({
    system: request?.system || [],
    tools: request?.tools || [],
    messages: request?.messages || [],
  });
  // The JSON representation includes block/message structure and every known or
  // future content field, including tool inputs and signed thinking payloads.
  const uncalibratedTokens = Math.max(1, Math.ceil(serialized.length / CHARS_PER_TOKEN));
  const factor =
    Number.isFinite(calibrationFactor) && calibrationFactor > 0 ? calibrationFactor : INITIAL_CALIBRATION_FACTOR;
  return {
    uncalibratedTokens,
    calibratedTokens: Math.max(1, Math.ceil(uncalibratedTokens * factor)),
    calibrationFactor: factor,
    serializedChars: serialized.length,
    fingerprint: fingerprint({
      system: request?.system || [],
      tools: request?.tools || [],
      messages: request?.messages || [],
    }),
  };
}

function observedInputOccupancy(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const fields = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
  const values = fields.map((field) => Number(usage[field] || 0));
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? total : null;
}

function calibrationForModel(contextState, model, catalogVersion) {
  const entry = contextState?.calibrationByModel?.[model];
  if (!entry || entry.catalogVersion !== catalogVersion || !Number.isFinite(entry.factor)) {
    return { factor: INITIAL_CALIBRATION_FACTOR, samples: 0, lastObservedTokens: null };
  }
  return {
    factor: Math.min(CALIBRATION_MAX, Math.max(CALIBRATION_MIN, entry.factor)),
    samples: Math.max(0, Number(entry.samples) || 0),
    lastObservedTokens: Number(entry.lastObservedTokens) || null,
  };
}

function updateCalibration(contextState, pending, response) {
  const observed = observedInputOccupancy(response?.usage);
  if (!pending || !observed || pending.model !== response?._contextRequest?.model) return contextState;
  if (pending.fingerprint !== response._contextRequest.fingerprint) return contextState;
  if (!Number.isFinite(pending.uncalibratedTokens) || pending.uncalibratedTokens <= 0) return contextState;

  const rawFactor = observed / pending.uncalibratedTokens;
  const prior = Number.isFinite(pending.factor) ? pending.factor : INITIAL_CALIBRATION_FACTOR;
  const next = Math.min(
    CALIBRATION_MAX,
    Math.max(CALIBRATION_MIN, prior * (1 - CALIBRATION_ALPHA) + rawFactor * CALIBRATION_ALPHA),
  );
  return {
    ...(contextState || {}),
    calibrationByModel: {
      ...(contextState?.calibrationByModel || {}),
      [pending.model]: {
        factor: next,
        samples: (pending.samples || 0) + 1,
        lastObservedTokens: observed,
        catalogVersion: pending.catalogVersion,
      },
    },
  };
}

function makePendingCalibration(identity, estimate, calibration, model, catalogVersion) {
  return {
    requestId: identity.requestId,
    runId: identity.runId,
    step: identity.step,
    model,
    catalogVersion,
    fingerprint: estimate.fingerprint,
    uncalibratedTokens: estimate.uncalibratedTokens,
    calibratedTokens: estimate.calibratedTokens,
    factor: calibration.factor,
    samples: calibration.samples,
  };
}

module.exports = {
  INITIAL_CALIBRATION_FACTOR,
  CALIBRATION_ALPHA,
  CALIBRATION_MIN,
  CALIBRATION_MAX,
  stableJson,
  fingerprint,
  estimateRequest,
  observedInputOccupancy,
  calibrationForModel,
  updateCalibration,
  makePendingCalibration,
};
