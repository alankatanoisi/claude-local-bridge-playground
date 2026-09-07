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

module.exports = { contentHash };
