// eslint.config.cjs — CommonJS format (avoids MODULE_TYPELESS_PACKAGE_JSON warning)
'use strict';

const globals = require('globals');
const js = require('@eslint/js');
const noRawAuthorityFlags = require('./scripts/eslint-rules/no-raw-authority-flags');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      'no-console': 'off',
    },
  },
  {
    // Runner permission flags need structural checking: JavaScript has several
    // equivalent ways to read a property, so a text search is insufficient.
    files: ['src/runner/**/*.js'],
    plugins: { runner: { rules: { 'no-raw-authority-flags': noRawAuthorityFlags } } },
    rules: { 'runner/no-raw-authority-flags': 'error' },
  },
];
