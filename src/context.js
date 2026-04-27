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
    interceptedHeaderType: null, // 'api-key' | 'bearer'
    interceptedSource: null,
    interceptedHost: null, // actual hostname Claude Code calls (may not be api.anthropic.com)
    interceptedPort: null, // actual port (usually 443)

    // Live captured fingerprint (self-adapting)
    liveFingerprint: null, // captured headers from Claude Code's actual requests
    liveFingerprintCapturedAt: 0, // timestamp of last fingerprint capture

    // Interceptor original function references (for clean uninstall)
    _originalHttpsRequest: null,
    _interceptedRequest: null,

    // Identity (for logging/debug)
    sessionId: randomUUID(),
    extensionVersion: '1.0.0',
  };
}

module.exports = { createContext };
