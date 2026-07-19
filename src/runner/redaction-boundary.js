'use strict';

/**
 * redaction-boundary.js — One chokepoint for sink-facing scrubbing (P0-11).
 *
 * Tool results already scrub in tool-registry. This module covers the remaining
 * fan-out: stdout / --json / --stream-json, SSE live text, display copies of
 * tool inputs, session persistence, and ledger payloads.
 *
 * Execution paths keep raw values (e.g. write_file body) so token-like project
 * content is still written verbatim; only display/persist copies are scrubbed.
 */

const safety = require('./safety');

/**
 * Deep-walk strings with scrubSecrets. Unlike scrubObject, this does NOT
 * obliterate values solely because a key looks like sessionId/deviceId —
 * those keys stay so resume metadata remains usable. Label-aware stable-id
 * scrubbing inside string *text* still runs via scrubSecrets.
 *
 * @param {*} value
 * @returns {*}
 */
function scrubDeepSecrets(value) {
  if (typeof value === 'string') return safety.scrubSecrets(value);
  if (Array.isArray(value)) return value.map(scrubDeepSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = scrubDeepSecrets(item);
    }
    return out;
  }
  return value;
}

/**
 * Per-run redaction helpers. Create once at run start when possible.
 */
function createRedactionBoundary() {
  const streamScrubber = safety.makeStreamingScrubber();
  return {
    scrubDeepSecrets,
    scrubText: (text) => safety.scrubSecrets(text),
    stream: streamScrubber,
  };
}

module.exports = {
  scrubDeepSecrets,
  createRedactionBoundary,
};
