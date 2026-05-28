'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const https = require('node:https');
const { createContext } = require('../src/context');
const { install, uninstall } = require('../src/interceptors/https');

test('install captures bearer auth from https.request', () => {
  const ctx = createContext();
  ctx.outputChannel = { appendLine: () => {} };
  const originalRequest = https.request;
  let called = null;

  https.request = (...args) => {
    called = args;
    return { sentinel: true };
  };

  try {
    install(ctx);
    const result = https.request({
      hostname: 'api.anthropic.com',
      headers: { authorization: 'Bearer ' + 'token-https' },
    });

    assert.ok(called);
    assert.equal(result.sentinel, true);
    assert.equal(ctx.interceptedToken, 'token-https');
    assert.equal(ctx.interceptedHeaderType, 'bearer');
    assert.equal(ctx.interceptedSource, 'intercepted:bearer');
    assert.equal(ctx.interceptedHost, 'api.anthropic.com');
  } finally {
    uninstall(ctx);
    https.request = originalRequest;
  }
});

test('install captures fingerprint from fetch and uninstall restores', async () => {
  const ctx = createContext();
  ctx.outputChannel = { appendLine: () => {} };
  const originalFetch = globalThis.fetch;
  const originalRequest = https.request;

  let fetchCalled = false;
  globalThis.fetch = async (input, init) => {
    fetchCalled = true;
    return {
      input,
      init,
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    };
  };
  https.request = () => ({});

  try {
    install(ctx);
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      headers: {
        authorization: 'Bearer ' + 'token-fetch',
        'user-agent': 'claude-cli/2.0.0',
        'x-app': 'cli',
        'x-claude-code-session-id': 'session-1',
        'x-anthropic-billing-header': 'billing',
      },
    });

    assert.equal(fetchCalled, true);
    assert.equal(ctx.interceptedToken, 'token-fetch');
    assert.equal(ctx.liveFingerprint['user-agent'], 'claude-cli/2.0.0');
    assert.equal(ctx.liveFingerprint.messagesPath, '/v1/messages?beta=true');
    assert.equal(ctx.interceptedHost, 'api.anthropic.com');
  } finally {
    uninstall(ctx);
    globalThis.fetch = originalFetch;
    https.request = originalRequest;
  }
});
