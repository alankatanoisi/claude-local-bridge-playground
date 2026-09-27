'use strict';

/**
 * Turn a logical artifact name into one safe filesystem basename.
 *
 * Both sides of the artifact contract must use this exact function:
 *   - RunLedger uses it when WRITING an artifact.
 *   - worker-resume uses it when READING that artifact later.
 *
 * Keeping the rule here prevents a document id containing spaces, slashes,
 * or punctuation from being written under one name and resumed under another.
 * The replacement also removes path separators, so the result stays inside
 * the run's artifacts directory.
 */
function safeArtifactName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

module.exports = { safeArtifactName };
