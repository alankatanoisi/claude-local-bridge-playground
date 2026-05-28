'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  adaptiveMessagesPath,
  buildAdaptiveAuthHeaders,
  extractFingerprint,
  getLiveSystemBlocks,
  updateFingerprint,
} = require('../src/fingerprint');

test('extractFingerprint returns null without Claude markers', () => {
  const fingerprint = extractFingerprint({ 'x-random': 'value' });
  assert.equal(fingerprint, null);
});

test('extractFingerprint captures only whitelisted headers', () => {
  const fingerprint = extractFingerprint({
    'User-Agent': 'claude-cli/2.0.0 (test)',
    'Anthropic-Version': '2023-06-01',
    'X-App': 'cli',
    'X-Ignored': 'nope',
  });

  assert.equal(fingerprint['user-agent'], 'claude-cli/2.0.0 (test)');
  assert.equal(fingerprint['anthropic-version'], '2023-06-01');
  assert.equal(fingerprint['x-app'], 'cli');
  assert.equal(fingerprint['x-ignored'], undefined);
});

test('updateFingerprint merges values and records endpoint metadata', () => {
  const ctx = {
    liveFingerprint: { 'user-agent': 'old-agent' },
    liveFingerprintCapturedAt: 0,
    interceptedHost: null,
    interceptedPort: null,
  };
  const before = Date.now();

  updateFingerprint(ctx, {
    'anthropic-beta': 'new-beta',
    endpoint: { hostname: 'api.anthropic.com', port: 444 },
  });

  assert.equal(ctx.liveFingerprint['user-agent'], 'old-agent');
  assert.equal(ctx.liveFingerprint['anthropic-beta'], 'new-beta');
  assert.equal(ctx.interceptedHost, 'api.anthropic.com');
  assert.equal(ctx.interceptedPort, 444);
  assert.ok(ctx.liveFingerprintCapturedAt >= before);
});

test('buildAdaptiveAuthHeaders skips apiKey credentials', () => {
  const headers = buildAdaptiveAuthHeaders({ liveFingerprint: null }, { apiKey: 'api-key' });
  assert.equal(headers.authorization, undefined);
  assert.equal(headers['x-api-key'], undefined);
  assert.equal(headers['anthropic-version'], '2023-06-01');
});

test('buildAdaptiveAuthHeaders uses live fingerprint headers', () => {
  const ctx = {
    liveFingerprint: {
      'user-agent': 'claude-cli/2.1.0 (test)',
      'x-app': 'cli',
      endpoint: { hostname: 'api.anthropic.com' },
    },
  };

  const headers = buildAdaptiveAuthHeaders(ctx, { accessToken: 'token-123' });
  assert.equal(headers.authorization, 'Bearer ' + 'token-123');
  assert.equal(headers['user-agent'], 'claude-cli/2.1.0 (test)');
  assert.equal(headers['x-app'], 'cli');
  assert.equal(headers.endpoint, undefined);
});

test('buildAdaptiveAuthHeaders falls back to defaults without fingerprint', () => {
  const ctx = { liveFingerprint: null, sessionId: 'session-123' };
  const headers = buildAdaptiveAuthHeaders(ctx, { accessToken: 'token-456' });
  assert.equal(headers.authorization, 'Bearer ' + 'token-456');
  assert.ok(headers['anthropic-beta']);
  assert.equal(headers['x-claude-code-session-id'], 'session-123');
});

test('getLiveSystemBlocks returns null when billing header is missing', () => {
  const ctx = { liveFingerprint: { 'user-agent': 'claude-cli/2.0.0' } };
  assert.equal(getLiveSystemBlocks(ctx), null);
});

test('getLiveSystemBlocks returns billing header and default identity', () => {
  const ctx = { liveFingerprint: { 'x-anthropic-billing-header': 'billing-flag' } };
  const blocks = getLiveSystemBlocks(ctx);
  assert.equal(blocks.billingHeader, 'billing-flag');
  assert.ok(blocks.agentIdentity.includes('Claude agent'));
});

test('adaptiveMessagesPath prefers captured path over defaults', () => {
  const ctx = { liveFingerprint: { messagesPath: '/v1/messages?beta=true' } };
  assert.equal(adaptiveMessagesPath(ctx, { accessToken: 'token-789' }), '/v1/messages?beta=true');
  assert.equal(adaptiveMessagesPath({ liveFingerprint: null }, { accessToken: 'token-789' }), '/v1/messages?beta=true');
  assert.equal(adaptiveMessagesPath({ liveFingerprint: null }, { source: 'none' }), '/v1/messages');
});
