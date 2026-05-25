'use strict';

/**
 * GET /v1/debug — Status + credential source info
 */

const { sendJson } = require('../utils');
const { getCredentials, getCredentialAuthMode } = require('../credentials');
const { LISTED_MODELS } = require('../models');
const crypto = require('crypto');
const vscode = require('vscode');

function fingerprintSecret(secret) {
  if (!secret) return null;

  // A fingerprint is one-way: useful for comparing values in logs/debug, but
  // not enough to reconstruct the real OAuth token.
  return `sha256:${crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)}`;
}

async function handleDebug(ctx, _req, res) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const creds = getCredentials(ctx);

  const port = ctx.server?.address()?.port ?? config.get('port', 11437);

  sendJson(res, 200, {
    status: 'running',
    port,
    httpBaseUrl: `http://127.0.0.1:${port}`,
    sessionId: ctx.sessionId,
    extensionVersion: ctx.extensionVersion,
    credentialPolicy: 'oauth-only',
    credentialSource: creds.source,
    upstreamAuthMode: getCredentialAuthMode(creds),
    authenticated: !!creds.accessToken,
    callerAuth: {
      enabled: config.get('requireCallerAuth', false),
      tokenSource: ctx.callerAuthTokenSource || 'uninitialized',
      tokenLoaded: !!ctx.callerAuthToken,
      tokenRotatedAt: ctx.callerAuthTokenRotatedAt ? new Date(ctx.callerAuthTokenRotatedAt).toISOString() : null,
      token: ctx.callerAuthToken ? '[REDACTED]' : null,
    },
    interceptedToken: ctx.interceptedToken ? '[redacted]' : null,
    interceptedTokenFingerprint: fingerprintSecret(ctx.interceptedToken),
    interceptedCredentialType: ctx.interceptedHeaderType || null,
    interceptedCredentialSource: ctx.interceptedSource || null,
    interceptedCredentialRejected: !!ctx.interceptedToken && ctx.interceptedToken === ctx.rejectedInterceptedToken,
    rejectedInterceptedAt: ctx.rejectedInterceptedAt ? new Date(ctx.rejectedInterceptedAt).toISOString() : null,
    interceptedHost: ctx.interceptedHost || null,
    interceptedPort: ctx.interceptedPort || null,
    liveFingerprint: ctx.liveFingerprint
      ? {
          capturedAt: new Date(ctx.liveFingerprintCapturedAt).toISOString(),
          headers: Object.keys(ctx.liveFingerprint).filter((k) => k !== 'endpoint' && k !== 'messagesPath'),
        }
      : null,
    captureProxy: ctx.captureProxy ? `http://localhost:11439` : null,
    anthropicBaseUrl: config.get('anthropicBaseUrl', 'https://api.anthropic.com'),
    availableModels: LISTED_MODELS.map((m) => m.id),
  });
}

/**
 * Show status in VS Code's information message
 */
async function showStatus(ctx) {
  const creds = getCredentials(ctx);
  const serverRunning = !!ctx.server?.listening;
  const port = ctx.server?.address()?.port;

  const lines = [
    `Server: ${serverRunning ? `✅ running on :${port}` : '❌ stopped'}`,
    `Credential source: ${creds.source}`,
    `Authenticated: ${creds.accessToken ? '✅ yes' : '❌ no'}`,
  ];

  vscode.window.showInformationMessage(lines.join('  |  '));
}

/**
 * Show credential source detail
 */
async function showCredentialSource(ctx) {
  const creds = getCredentials(ctx);
  const sourceMap = {
    'env:CLAUDE_CODE_OAUTH_TOKEN': 'CLAUDE_CODE_OAUTH_TOKEN environment variable',
    keychain: 'macOS Keychain (Claude Code-credentials)',
    'credentials-file': '~/.claude/.credentials.json',
    'intercepted:bearer': 'live intercepted Claude Code OAuth token',
    'proxy:bearer': 'capture proxy Claude Code OAuth token',
    none: 'No credentials found',
  };

  const detail = sourceMap[creds.source] || creds.source;
  const auth = !!creds.accessToken;

  vscode.window.showInformationMessage(
    auth
      ? `🔑 Claude Local Bridge — authenticated via: ${detail}`
      : `⚠️ Claude Local Bridge — no OAuth token found. Open Claude Code once so the bridge can capture or read its login.`,
  );
}

module.exports = { handleDebug, showStatus, showCredentialSource };
