'use strict';

const { randomUUID } = require('crypto');

/**
 * Shared mutable state for the Claude Local Bridge extension.
 * Created once in activate() and passed to every module.
 */
function createContext() {
  return {
    // VS Code UI
    /** @type {import('vscode').OutputChannel | null} */
    outputChannel: null,
    /** @type {import('vscode').StatusBarItem | null} */
    statusBarItem: null,

    // HTTP server
    /** @type {import('http').Server | null} */
    server: null,

    // Credential cache
    cachedCredentials: null,
    credentialsCachedAt: 0,
    CREDS_CACHE_TTL: 300_000, // 5 minutes

    // Intercepted credentials (from Claude Code's live outgoing HTTPS requests)
    interceptedToken: null,
    // Only Bearer tokens are useful for this playground. A captured x-api-key
    // value is treated as noise because it would not prove the OAuth path.
    interceptedHeaderType: null, // 'bearer'
    interceptedSource: null,
    interceptedHost: null, // actual hostname Claude Code calls (may not be api.anthropic.com)
    interceptedPort: null, // actual port (usually 443)
    rejectedInterceptedToken: null, // exact intercepted OAuth token rejected by upstream
    rejectedInterceptedAt: 0,

    // Live captured fingerprint (self-adapting)
    liveFingerprint: null, // captured headers from Claude Code's actual requests
    liveFingerprintCapturedAt: 0, // timestamp of last fingerprint capture

    // Interceptor original function references (for clean uninstall)
    _originalHttpsRequest: null,
    _interceptedRequest: null,

    // Caller-auth token metadata
    callerAuthToken: null,
    callerAuthTokenSource: 'uninitialized',
    callerAuthTokenRotatedAt: null,

    // Identity (for logging/debug)
    sessionId: randomUUID(),
    extensionVersion: '1.0.0',

    // Extra local lock for /v1/debug*. Localhost means "same Mac", not
    // "same trusted user action", so debug pages need a lightweight gate.
    sensitiveEndpointToken: randomUUID(),
  };
}

module.exports = { createContext };
