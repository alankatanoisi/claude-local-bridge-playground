'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createContext } = require('../src/context');

test('createContext initializes defaults and identifiers', () => {
  const ctx = createContext();

  assert.equal(ctx.outputChannel, null);
  assert.equal(ctx.statusBarItem, null);
  assert.equal(ctx.server, null);
  assert.equal(ctx.cachedCredentials, null);
  assert.equal(ctx.credentialsCachedAt, 0);
  assert.equal(ctx.CREDS_CACHE_TTL, 300_000);
  assert.equal(ctx.interceptedToken, null);
  assert.equal(ctx.interceptedHeaderType, null);
  assert.ok(ctx.sessionId);
  assert.ok(ctx.sensitiveEndpointToken);
});
