'use strict';

const fs = require('node:fs');
const { DEFAULT_BINARY } = require('../../src/starlark');

// Missing optional tooling is a visible skip, never a weakened assertion.
// Installing the executable automatically enables the original test body.
const evaluatorRequired = {
  skip: !fs.existsSync(DEFAULT_BINARY) && `missing starlark-eval binary: ${DEFAULT_BINARY}`,
};

module.exports = { evaluatorRequired };
