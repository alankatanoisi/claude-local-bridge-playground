// eslint.config.cjs — CommonJS format (avoids MODULE_TYPELESS_PACKAGE_JSON warning)
'use strict';

const globals = require('globals');
const js = require('@eslint/js');

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
];
