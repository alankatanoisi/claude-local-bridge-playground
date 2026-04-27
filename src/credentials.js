'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { log } = require('./utils');
const { buildAdaptiveAuthHeaders, getLiveSystemBlocks, adaptiveMessagesPath } = require('./fingerprint');

// ─────────────────────────────────────────────
// Credential Discovery
//
// Priority order:
//   1. ANTHROPIC_API_KEY env var         → x-api-key header
//   2. CLAUDE_CODE_OAUTH_TOKEN env var   → Bearer header
//   3. macOS Keychain (Claude Code-credentials)
//   4. ~/.claude/.credentials.json       (Linux/Windows, also macOS fallback)
//   5. VS Code setting claudeLocalBridge.apiKey
//
// Returns: { apiKey?, accessToken?, source }
// ─────────────────────────────────────────────

/**
 * @typedef {{ apiKey?: string, accessToken?: string, source: string }} Credentials
 */

/**
 * Read and parse the Claude Code credentials JSON.
 * Structure: { claudeAiOauth: { accessToken, refreshToken, expiresAt, ... } }
 * @param {string} raw Raw JSON string from keychain or file
 * @returns {string|null} accessToken or null
 */
function parseClaudeCodeCredentials(raw) {
  try {
    const parsed = JSON.parse(raw.trim());
    const token = parsed?.claudeAiOauth?.accessToken || parsed?.accessToken || parsed?.oauth_token || null;
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Attempt to read the Claude Code OAuth token from the macOS Keychain.
 * Uses `security find-generic-password` CLI.
 * @returns {string|null}
 */
function readKeychainToken() {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execSync("security find-generic-password -s 'Claude Code-credentials' -w", {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return parseClaudeCodeCredentials(raw);
  } catch {
    return null;
  }
}

/**
 * Attempt to read the Claude Code OAuth token from the credentials file.
 * Location: ~/.claude/.credentials.json  (Linux, Windows, and macOS fallback)
 * @returns {string|null}
 */
function readCredentialsFile() {
  const credDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const credFile = path.join(credDir, '.credentials.json');
  try {
    if (!fs.existsSync(credFile)) return null;
    const raw = fs.readFileSync(credFile, 'utf8');
    return parseClaudeCodeCredentials(raw);
  } catch {
    return null;
  }
}

/**
 * Discover credentials using the priority chain.
 * @param {object} ctx Bridge context
 * @returns {Credentials}
 */
function discoverCredentials(ctx) {
  // Priority 0: intercepted token from Claude Code's live outgoing HTTPS requests
  // This is captured by src/interceptors/https.js patching https.request.
  // It's the most reliable source — always the live token, auto-refreshes on rotation.
  if (ctx.interceptedToken) {
    return {
      ...(ctx.interceptedHeaderType === 'api-key'
        ? { apiKey: ctx.interceptedToken }
        : { accessToken: ctx.interceptedToken }),
      source: ctx.interceptedSource || 'intercepted',
    };
  }

  // Priority 1: ANTHROPIC_API_KEY env var
  if (process.env.ANTHROPIC_API_KEY) {
    log(ctx, '🔑 Credentials: ANTHROPIC_API_KEY env var');
    return { apiKey: process.env.ANTHROPIC_API_KEY, source: 'env:ANTHROPIC_API_KEY' };
  }

  // Priority 2: CLAUDE_CODE_OAUTH_TOKEN env var
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    log(ctx, '🔑 Credentials: CLAUDE_CODE_OAUTH_TOKEN env var');
    return { accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN, source: 'env:CLAUDE_CODE_OAUTH_TOKEN' };
  }

  // Priority 3: macOS Keychain
  const keychainToken = readKeychainToken();
  if (keychainToken) {
    log(ctx, '🔑 Credentials: macOS Keychain (Claude Code-credentials)');
    return { accessToken: keychainToken, source: 'keychain' };
  }

  // Priority 4: ~/.claude/.credentials.json
  const fileToken = readCredentialsFile();
  if (fileToken) {
    log(ctx, '🔑 Credentials: ~/.claude/.credentials.json');
    return { accessToken: fileToken, source: 'credentials-file' };
  }

  // Priority 5: VS Code setting
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const manualKey = config.get('apiKey', '');
  if (manualKey && manualKey.trim()) {
    log(ctx, '🔑 Credentials: VS Code setting claudeLocalBridge.apiKey');
    return { apiKey: manualKey.trim(), source: 'vscode-setting' };
  }

  log(ctx, '⚠️ Credentials: none found — requests will be unauthenticated', true);
  return { source: 'none' };
}

/**
 * Get credentials with caching.
 * @param {object} ctx
 * @returns {Credentials}
 */
function getCredentials(ctx) {
  const now = Date.now();
  if (ctx.cachedCredentials && now - ctx.credentialsCachedAt < ctx.CREDS_CACHE_TTL) {
    return ctx.cachedCredentials;
  }
  const creds = discoverCredentials(ctx);
  ctx.cachedCredentials = creds;
  ctx.credentialsCachedAt = now;
  return creds;
}

/**
 * Clear the credential cache (e.g. after a 401 response).
 * @param {object} ctx
 */
function clearCredentialsCache(ctx) {
  ctx.cachedCredentials = null;
  ctx.credentialsCachedAt = 0;
}

// Captured from a live Claude Code 2.1.119 request on 2026-04-27.
// These mimic exactly what the CLI sends so Anthropic accepts an OAuth token.
// Tweak via VS Code settings if Anthropic rotates the expected values.
const CLAUDE_CODE_FINGERPRINT = {
  userAgent: 'claude-cli/2.1.119 (external, claude-vscode, agent-sdk/0.2.120)',
  anthropicBeta:
    'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24',
  // Stainless = the Anthropic SDK's self-identification headers.
  stainless: {
    'x-stainless-arch': 'arm64',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'MacOS',
    'x-stainless-package-version': '0.81.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': process.version,
    'x-stainless-timeout': '600',
  },
  // First system block Claude Code sends — a billing/telemetry tag.
  // The cch=... value is opaque (likely a server-validated hash); it may rot.
  billingHeader:
    'x-anthropic-billing-header: cc_version=2.1.119.401; cc_entrypoint=claude-vscode; cch=d0a6f;',
  // Second system block — the SDK identity statement.
  agentIdentity: "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
};

/**
 * Build the auth + identity headers for an Anthropic API call.
 * For OAuth (Bearer) creds, we emit the full Claude Code header set so the
 * gateway treats the call as a first-party Claude Code request.
 *
 * Uses the live captured fingerprint if available (self-adapting), falling
 * back to hardcoded values only when no live fingerprint exists.
 *
 * @param {object} ctx Bridge context
 * @param {Credentials} creds
 * @returns {Record<string, string>}
 */
function buildAuthHeaders(ctx, creds) {
  return buildAdaptiveAuthHeaders(ctx, creds);
}

/**
 * Reshape a request body's `system` field into the array form Claude Code
 * uses, prepending the billing header and SDK identity blocks. Only applied
 * when the credential is an OAuth/Bearer token — API-key requests are left
 * untouched so they keep working in their normal first-party API mode.
 *
 * Uses the live captured billing header if available (self-adapting).
 *
 * @param {object} ctx Bridge context
 * @param {object} body Parsed Anthropic request body (mutated in place)
 * @param {Credentials} creds
 */
function prependClaudeCodeSystem(ctx, body, creds) {
  if (!creds.accessToken) return body;

  const liveBlocks = getLiveSystemBlocks(ctx);
  if (liveBlocks) {
    // Use live captured billing header
    const billingBlock = { type: 'text', text: liveBlocks.billingHeader };
    const identityBlock = {
      type: 'text',
      text: liveBlocks.agentIdentity,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    };

    let userBlocks = [];
    if (typeof body.system === 'string' && body.system.length > 0) {
      userBlocks = [
        {
          type: 'text',
          text: body.system,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ];
    } else if (Array.isArray(body.system)) {
      userBlocks = body.system;
    }

    body.system = [billingBlock, identityBlock, ...userBlocks];
  } else {
    // Fallback to hardcoded fingerprint
    const billingBlock = { type: 'text', text: CLAUDE_CODE_FINGERPRINT.billingHeader };
    const identityBlock = {
      type: 'text',
      text: CLAUDE_CODE_FINGERPRINT.agentIdentity,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    };

    let userBlocks = [];
    if (typeof body.system === 'string' && body.system.length > 0) {
      userBlocks = [
        {
          type: 'text',
          text: body.system,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ];
    } else if (Array.isArray(body.system)) {
      userBlocks = body.system;
    }

    body.system = [billingBlock, identityBlock, ...userBlocks];
  }

  return body;
}

/** Path suffix Claude Code uses when posting messages with OAuth. */
function messagesPathFor(ctx, creds) {
  return adaptiveMessagesPath(ctx, creds);
}

module.exports = {
  getCredentials,
  clearCredentialsCache,
  buildAuthHeaders,
  prependClaudeCodeSystem,
  messagesPathFor,
  CLAUDE_CODE_FINGERPRINT,
};
