'use strict';

/**
 * GET /v1/debug — Status + credential source info
 */

const { sendJson } = require('../utils');
const { getCredentials, getCredentialAuthMode } = require('../credentials');
const { LISTED_MODELS } = require('../models');
const vscode = require('vscode');

async function handleDebug(ctx, _req, res) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const creds = getCredentials(ctx);

  const port = ctx.server?.address()?.port ?? config.get('port', 11436);

  sendJson(res, 200, {
    status: 'running',
    port,
    sessionId: ctx.sessionId,
    extensionVersion: ctx.extensionVersion,
    credentialSource: creds.source,
    upstreamAuthMode: getCredentialAuthMode(creds),
    authenticated: !!(creds.apiKey || creds.accessToken),
    callerAuth: {
      enabled: config.get('requireCallerAuth', true),
      tokenSource: ctx.callerAuthTokenSource || 'uninitialized',
      tokenLoaded: !!ctx.callerAuthToken,
      tokenRotatedAt: ctx.callerAuthTokenRotatedAt ? new Date(ctx.callerAuthTokenRotatedAt).toISOString() : null,
      token: ctx.callerAuthToken ? '[REDACTED]' : null,
    },
    interceptedToken: ctx.interceptedToken
      ? `${ctx.interceptedToken.slice(0, 8)}...${ctx.interceptedToken.slice(-4)}`
      : null,
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
    `Authenticated: ${creds.apiKey || creds.accessToken ? '✅ yes' : '❌ no'}`,
  ];

  vscode.window.showInformationMessage(lines.join('  |  '));
}

/**
 * Show credential source detail
 */
async function showCredentialSource(ctx) {
  const creds = getCredentials(ctx);
  const sourceMap = {
    'env:ANTHROPIC_API_KEY': 'ANTHROPIC_API_KEY environment variable',
    'env:CLAUDE_CODE_OAUTH_TOKEN': 'CLAUDE_CODE_OAUTH_TOKEN environment variable',
    keychain: 'macOS Keychain (Claude Code-credentials)',
    'credentials-file': '~/.claude/.credentials.json',
    'vscode-setting': 'VS Code setting claudeLocalBridge.apiKey',
    none: 'No credentials found',
  };

  const detail = sourceMap[creds.source] || creds.source;
  const auth = !!(creds.apiKey || creds.accessToken);

  vscode.window.showInformationMessage(
    auth
      ? `🔑 Claude Local Bridge — authenticated via: ${detail}`
      : `⚠️ Claude Local Bridge — no credentials found. Set ANTHROPIC_API_KEY or install Claude Code.`,
  );
}

module.exports = { handleDebug, showStatus, showCredentialSource };
