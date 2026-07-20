'use strict';

// ─────────────────────────────────────────────
// P1-06 fingerprint containment tests (2026-07-20)
//
// Finding: the adaptive fingerprint replayed one captured request's
// per-request/session state (session id, retry count, timeout, billing
// header, request-shape beta flags) globally onto every later bridge
// request. Containment: classify headers as stable-identity vs
// request-specific inside src/fingerprint.js and only replay the stable
// group, in both the live-capture path and the hardcoded fallback path.
// ─────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert');

const fingerprint = require('../src/fingerprint');

describe('P1-06 header classification', () => {
  it('splits captured headers into stable-identity and request-specific groups', () => {
    // Every captured header (except the mixed anthropic-beta) must belong
    // to exactly one group, so nothing replays by accident.
    for (const header of fingerprint.CAPTURED_HEADERS) {
      if (header === 'anthropic-beta') continue;
      const stable = fingerprint.STABLE_IDENTITY_HEADERS.has(header);
      const requestSpecific = fingerprint.REQUEST_SPECIFIC_HEADERS.has(header);
      assert.equal(stable !== requestSpecific, true, `${header} must be in exactly one classification group`);
    }
  });

  it('classifies session, retry, timeout, and billing state as request-specific', () => {
    for (const header of [
      'x-claude-code-session-id',
      'x-stainless-retry-count',
      'x-stainless-timeout',
      'x-stainless-variant',
      'x-stainless-stream-helper',
      'x-anthropic-billing-header',
    ]) {
      assert.equal(fingerprint.REQUEST_SPECIFIC_HEADERS.has(header), true, `${header} should be request-specific`);
    }
  });
});

describe('P1-06 sanitizeBetaList', () => {
  it('drops request-shape beta flags regardless of date suffix', () => {
    assert.equal(
      fingerprint.sanitizeBetaList(
        'claude-code-20250219,oauth-2025-04-20,context-1m-2025-08-07,fallback-credit-2026-06-01',
      ),
      'claude-code-20250219,oauth-2025-04-20',
    );
    // Rotated dates are still caught by prefix matching.
    assert.equal(fingerprint.sanitizeBetaList('context-1m-2027-01-01,oauth-2025-04-20'), 'oauth-2025-04-20');
  });

  it('returns null when nothing stable remains or input is not a string', () => {
    assert.equal(fingerprint.sanitizeBetaList('context-1m-2025-08-07'), null);
    assert.equal(fingerprint.sanitizeBetaList(''), null);
    assert.equal(fingerprint.sanitizeBetaList(undefined), null);
    assert.equal(fingerprint.sanitizeBetaList(42), null);
  });
});

describe('P1-06 live fingerprint replay containment', () => {
  const liveCtx = () => ({
    liveFingerprint: {
      'user-agent': 'claude-cli/2.2.0 (test)',
      'x-app': 'cli',
      'x-stainless-os': 'MacOS',
      'anthropic-beta': 'oauth-2025-04-20,context-1m-2025-08-07',
      // Captured request-specific state from someone else's request:
      'x-claude-code-session-id': 'captured-session-abc',
      'x-stainless-retry-count': '2',
      'x-stainless-timeout': '600',
      'x-stainless-stream-helper': 'messages',
      'x-stainless-variant': 'beta',
      'x-anthropic-billing-header': 'billing-blob',
      // Bookkeeping fields stored on the fingerprint, not real headers:
      endpoint: { hostname: 'api.anthropic.com', port: 443 },
      messagesPath: '/v1/messages?beta=true',
    },
  });

  it('replays stable identity headers only', () => {
    const headers = fingerprint.buildAdaptiveAuthHeaders(liveCtx(), { accessToken: 'tok' });
    assert.equal(headers['user-agent'], 'claude-cli/2.2.0 (test)');
    assert.equal(headers['x-app'], 'cli');
    assert.equal(headers['x-stainless-os'], 'MacOS');
    assert.equal(headers['anthropic-beta'], 'oauth-2025-04-20');
  });

  it('never replays captured request-specific state onto other requests', () => {
    const headers = fingerprint.buildAdaptiveAuthHeaders(liveCtx(), { accessToken: 'tok' });
    for (const header of fingerprint.REQUEST_SPECIFIC_HEADERS) {
      assert.equal(headers[header], undefined, `${header} must not be replayed`);
    }
    // Bookkeeping fields must not leak out as HTTP headers either.
    assert.equal(headers['endpoint'], undefined);
    assert.equal(headers['messagesPath'], undefined);
  });

  it('omits anthropic-beta entirely when only request-shape flags were captured', () => {
    const ctx = { liveFingerprint: { 'x-app': 'cli', 'anthropic-beta': 'context-1m-2025-08-07' } };
    const headers = fingerprint.buildAdaptiveAuthHeaders(ctx, { accessToken: 'tok' });
    assert.equal(headers['anthropic-beta'], undefined);
  });
});

describe('P1-06 fallback fingerprint containment', () => {
  it('does not fabricate request-specific state in the fallback path', () => {
    const headers = fingerprint.buildAdaptiveAuthHeaders(
      { liveFingerprint: null, sessionId: 'bridge-session-1' },
      { accessToken: 'tok' },
    );
    assert.equal(headers['x-claude-code-session-id'], undefined);
    assert.equal(headers['x-stainless-retry-count'], undefined);
    assert.equal(headers['x-stainless-timeout'], undefined);
    // Beta list keeps protocol/feature flags the runner transport uses...
    assert.match(headers['anthropic-beta'], /claude-code-20250219/);
    assert.match(headers['anthropic-beta'], /oauth-2025-04-20/);
    assert.match(headers['anthropic-beta'], /effort-2025-11-24/);
    // ...but no request-shape or billing opt-ins.
    assert.doesNotMatch(headers['anthropic-beta'], /context-1m-/);
    assert.doesNotMatch(headers['anthropic-beta'], /fallback-credit-/);
  });

  it('still captures the billing header for system blocks without replaying it', () => {
    // getLiveSystemBlocks is the sanctioned consumer of the captured
    // billing value; the raw header must not appear in outgoing headers.
    const ctx = {
      liveFingerprint: { 'x-app': 'cli', 'x-anthropic-billing-header': 'billing-blob' },
    };
    const blocks = fingerprint.getLiveSystemBlocks(ctx);
    assert.equal(blocks.billingHeader, 'billing-blob');
    const headers = fingerprint.buildAdaptiveAuthHeaders(ctx, { accessToken: 'tok' });
    assert.equal(headers['x-anthropic-billing-header'], undefined);
  });
});
