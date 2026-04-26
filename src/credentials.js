'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { log } = require('./utils');

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

/**
 * Build the auth headers for Anthropic API calls given a Credentials object.
 * @param {Credentials} creds
 * @returns {Record<string, string>}
 */
function buildAuthHeaders(creds) {
  const headers = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  if (creds.apiKey) {
    headers['x-api-key'] = creds.apiKey;
  } else if (creds.accessToken) {
    headers['authorization'] = `Bearer ${creds.accessToken}`;
  }
  return headers;
}

module.exports = { getCredentials, clearCredentialsCache, buildAuthHeaders };
