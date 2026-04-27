'use strict';

// ─────────────────────────────────────────────
// Adaptive Fingerprint Capture
//
// Instead of hardcoding Claude Code's request fingerprint,
// this module captures it live from intercepted traffic.
//
// The interceptor already sees every outgoing Claude Code
// request. We extract and store the full header set, then
// replay it exactly when proxying requests.
//
// This makes the bridge self-adapting: when Claude Code
// updates its version, rotates fingerprints, or changes
// endpoints, the bridge automatically mirrors the new values.
// ─────────────────────────────────────────────

/**
 * Headers we want to capture from Claude Code's outgoing requests.
 * This is a strict whitelist — only these headers are captured and replayed.
 * No auth tokens, cookies, or internal headers can leak through.
 *
 * These are the values that Anthropic's gateway validates to identify
 * the client as a legitimate Claude Code instance.
 */
const CAPTURED_HEADERS = new Set([
  'user-agent',
  'anthropic-version',
  'anthropic-beta',
  'x-anthropic-billing-header',
  'x-app',
  'x-claude-code-session-id',
  'accept',
  'content-type',
  // Stainless SDK headers (Anthropic SDK self-identification)
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-retry-count',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
  'x-stainless-timeout',
  'x-stainless-variant',
  'x-stainless-stream-helper',
]);

/**
 * Extract a fingerprint from an intercepted request's headers.
 *
 * @param {object} headers - The request headers from an intercepted Claude Code request
 * @returns {object|null} - Captured fingerprint or null if no relevant headers found
 */
function extractFingerprint(headers) {
  if (!headers) return null;

  // Normalize header keys to lowercase
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  // Check if this looks like a Claude Code request
  const hasClaudeCodeMarker =
    normalized['user-agent']?.includes('claude') ||
    normalized['x-app'] === 'cli' ||
    normalized['x-claude-code-session-id'] !== undefined;

  if (!hasClaudeCodeMarker) return null;

  // Extract captured headers
  const fingerprint = {};
  for (const header of CAPTURED_HEADERS) {
    if (normalized[header] !== undefined) {
      fingerprint[header] = normalized[header];
    }
  }

  // Only return if we captured something meaningful
  if (Object.keys(fingerprint).length === 0) return null;

  return fingerprint;
}

/**
 * Update the live fingerprint in the context.
 * Merges new values with existing ones, preferring newer values.
 *
 * @param {object} ctx - Bridge context
 * @param {object} fingerprint - New fingerprint to merge
 */
function updateFingerprint(ctx, fingerprint) {
  if (!fingerprint) return;

  const existing = ctx.liveFingerprint || {};
  ctx.liveFingerprint = { ...existing, ...fingerprint };
  ctx.liveFingerprintCapturedAt = Date.now();

  // Also capture the endpoint if this is a new one
  if (fingerprint.endpoint) {
    ctx.interceptedHost = fingerprint.endpoint.hostname;
    ctx.interceptedPort = fingerprint.endpoint.port || 443;
  }
}

/**
 * Build auth headers using the live captured fingerprint.
 * Falls back to hardcoded values only when no live fingerprint exists.
 *
 * @param {object} ctx - Bridge context
 * @param {object} creds - Credentials object
 * @returns {object} - Auth headers for the Anthropic API
 */
function buildAdaptiveAuthHeaders(ctx, creds) {
  const headers = {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };

  if (creds.apiKey) {
    headers['x-api-key'] = creds.apiKey;
    return headers;
  }

  if (creds.accessToken) {
    headers['authorization'] = `Bearer ${creds.accessToken}`;

    // Use live fingerprint if available
    const fp = ctx.liveFingerprint;
    if (fp) {
      // Merge all captured headers
      for (const [key, value] of Object.entries(fp)) {
        if (key !== 'endpoint') {
          headers[key] = value;
        }
      }
    } else {
      // Fall back to hardcoded fingerprint
      headers['accept'] = 'application/json';
      headers['anthropic-beta'] =
        'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      headers['user-agent'] = 'claude-cli/2.1.119 (external, claude-vscode, agent-sdk/0.2.120)';
      headers['x-app'] = 'cli';
      headers['x-claude-code-session-id'] = ctx.sessionId;
      headers['x-stainless-arch'] = 'arm64';
      headers['x-stainless-lang'] = 'js';
      headers['x-stainless-os'] = 'MacOS';
      headers['x-stainless-package-version'] = '0.81.0';
      headers['x-stainless-retry-count'] = '0';
      headers['x-stainless-runtime'] = 'node';
      headers['x-stainless-runtime-version'] = process.version;
      headers['x-stainless-timeout'] = '600';
    }
  }

  return headers;
}

/**
 * Get the system blocks from the live fingerprint.
 * Claude Code sends billing and identity blocks in the system field.
 *
 * @param {object} ctx - Bridge context
 * @returns {object|null} - System blocks or null
 */
function getLiveSystemBlocks(ctx) {
  const fp = ctx.liveFingerprint;
  if (!fp) return null;

  // The billing header is captured from live traffic
  const billingHeader = fp['x-anthropic-billing-header'];
  if (!billingHeader) return null;

  return {
    billingHeader,
    // The agent identity is typically the same across versions
    agentIdentity: fp['agent-identity'] || "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
  };
}

/**
 * Get the messages path from the live fingerprint.
 * Claude Code may use different paths for OAuth vs API key auth.
 *
 * @param {object} ctx - Bridge context
 * @param {object} creds - Credentials object
 * @returns {string} - Messages path
 */
function adaptiveMessagesPath(ctx, creds) {
  const fp = ctx.liveFingerprint;
  if (fp && fp.messagesPath) {
    return fp.messagesPath;
  }
  // Fallback
  return creds.accessToken ? '/v1/messages?beta=true' : '/v1/messages';
}

module.exports = {
  extractFingerprint,
  updateFingerprint,
  buildAdaptiveAuthHeaders,
  getLiveSystemBlocks,
  adaptiveMessagesPath,
  CAPTURED_HEADERS,
};
