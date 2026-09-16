'use strict';

const crypto = require('node:crypto');

// Object-key ordering is a serialization detail; array ordering is part of a
// plan. Canonical JSON sorts only object keys so equivalent objects hash alike.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function contentHash(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

// R14b: the three fingerprints recorded next to every accepted plan. Pure so
// the coordinator (when accepting) and worker-resume.js (when verifying) are
// guaranteed to compute them the same way.
//   planHash    — the accepted descriptor list.
//   programHash — the accepted, possibly lint-repaired Starlark source; for
//                 host_json the descriptor list IS the program.
//   inputHash   — the run's input fingerprint; recovery plans fold the initial
//                 failure records in, because those are recovery's inputs too.
function acceptedPlanHashes({ jobs, program = null, failures = null, inputHash }) {
  return {
    algorithm: 'sha256-canonical-json-v1',
    planHash: contentHash(jobs),
    programHash: contentHash(program === null ? jobs : program),
    inputHash: failures ? contentHash({ inputHash, failures }) : inputHash,
  };
}

module.exports = { acceptedPlanHashes, contentHash };
