'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vscode = require('./__mocks__/vscode');
const { initializeCallerAuth } = require('../src/caller-auth');

function createSecretContext() {
  const values = new Map();
  return {
    values,
    secrets: {
      get: async (key) => values.get(key),
      store: async (key, value) => values.set(key, value),
    },
  };
}

test('caller auth defaults to disabled', async () => {
  vscode.__resetConfig();
  const ctx = {};
  const extensionContext = createSecretContext();

  await initializeCallerAuth(ctx, extensionContext);

  assert.equal(ctx.callerAuthToken, null);
  assert.equal(ctx.callerAuthTokenSource, 'disabled');
  assert.equal(extensionContext.values.size, 0);
});

test('caller auth uses configured static token when enabled', async () => {
  vscode.__resetConfig();
  vscode.__setConfig('requireCallerAuth', true);
  vscode.__setConfig('callerAuthToken', 'local-dev-token');
  const ctx = {};

  await initializeCallerAuth(ctx, createSecretContext());

  assert.equal(ctx.callerAuthToken, 'local-dev-token');
  assert.equal(ctx.callerAuthTokenSource, 'vscode-setting');
});

test('caller auth auto-generates a token only when enabled without a static token', async () => {
  vscode.__resetConfig();
  vscode.__setConfig('requireCallerAuth', true);
  const ctx = {};
  const extensionContext = createSecretContext();

  await initializeCallerAuth(ctx, extensionContext);

  assert.match(ctx.callerAuthToken, /^[a-f0-9]{48}$/);
  assert.equal(ctx.callerAuthTokenSource, 'secret-storage:auto-generated');
  assert.equal(extensionContext.values.has('claudeLocalBridge.callerAuthToken'), true);
});
