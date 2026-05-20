'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCredentials, clearCredentialsCache } = require('../../src/credentials');

describe('credentials cache watermark', () => {
  it('invalidates cache when intercepted token changes', () => {
    const ctx = { CREDS_CACHE_TTL: 60000, interceptedToken: 'token-v1' };

    // First call: cache populated with watermark
    const creds1 = getCredentials(ctx);
    assert.ok(creds1);
    // The cached credential should carry the watermark
    assert.ok(ctx.cachedCredentials);

    // Simulate token rotation: change intercepted token
    ctx.interceptedToken = 'token-v2';

    // Second call: watermark mismatch → cache invalidated → fresh credentials
    const creds2 = getCredentials(ctx);

    // The returned credentials should reflect the new intercepted token
    assert.ok(creds2);
    // Source should be intercepted (priority 0 with new token)
    assert.equal(creds2.source, 'intercepted');
    assert.equal(creds2.accessToken, 'token-v2');
  });

  it('returns cached credential when watermark matches', () => {
    const ctx = { CREDS_CACHE_TTL: 60000, interceptedToken: 'token-v3' };

    // Populate cache
    const creds1 = getCredentials(ctx);
    assert.equal(creds1.accessToken, 'token-v3');

    // Same token → watermark matches → use cache
    const creds2 = getCredentials(ctx);

    // The previously intercepted credential was the same token, so the cache
    // should have been populated (not from env/fallback)
    assert.ok(creds2);
  });

  it('clearCredentialsCache removes watermark', () => {
    const ctx = { CREDS_CACHE_TTL: 60000, interceptedToken: 'token-w1' };

    getCredentials(ctx);
    assert.ok(ctx.cachedCredentials);

    clearCredentialsCache(ctx);
    assert.equal(ctx.cachedCredentials, null);
    assert.equal(ctx.credentialsCachedAt, 0);
  });

  it('watermark is null for non-intercepted credentials (does not cause phantom invalidation)', () => {
    const ctx = { CREDS_CACHE_TTL: 60000 };
    // cachedCredentials watermark is null → should not invalidate on null check
    ctx.cachedCredentials = {
      source: 'env:ANTHROPIC_API_KEY',
      apiKey: 'sk-ant-env-key',
      interceptedWatermark: null,
    };
    ctx.credentialsCachedAt = Date.now();
    ctx.interceptedToken = null;

    const creds = getCredentials(ctx);
    assert.equal(creds.source, 'env:ANTHROPIC_API_KEY');
  });
});
