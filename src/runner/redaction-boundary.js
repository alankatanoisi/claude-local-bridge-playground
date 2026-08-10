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
  // `ancestors` tracks only the objects on the branch we are walking right
  // now. If one of those objects points back to itself (or to a parent), that
  // is a real cycle and following it again would recurse forever.
  //
  // We remove each object after finishing its branch. That detail means a
  // harmless shared object used in two different places is scrubbed normally
  // in both places instead of being mistaken for a circular reference.
  const ancestors = new WeakSet();

  function scrub(valueToScrub) {
    if (typeof valueToScrub === 'string') return safety.scrubSecrets(valueToScrub);
    if (!valueToScrub || typeof valueToScrub !== 'object') return valueToScrub;

    if (ancestors.has(valueToScrub)) return '[Circular]';
    ancestors.add(valueToScrub);

    try {
      // Build new arrays and objects rather than changing the caller's data.
      // Sink-facing copies are redacted; the live runner can keep using its
      // original, unsanitized values for the operation the user requested.
      if (Array.isArray(valueToScrub)) return valueToScrub.map((item) => scrub(item));

      const out = {};
      for (const [key, item] of Object.entries(valueToScrub)) {
        out[key] = scrub(item);
      }
      return out;
    } finally {
      ancestors.delete(valueToScrub);
    }
  }

  return scrub(value);
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
