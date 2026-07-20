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
 * P1-06 containment (2026-07-20): captured headers are now classified into
 * two groups so the bridge stops replaying one request's per-request state
 * onto every later request.
 *
 * STABLE identity headers describe *which client* is talking (client
 * version, SDK platform). They are safe to replay globally because they do
 * not change per request within one Claude Code install.
 */
const STABLE_IDENTITY_HEADERS = new Set([
  'user-agent',
  'anthropic-version',
  'x-app',
  'accept',
  'content-type',
  // Stainless SDK headers (Anthropic SDK self-identification)
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
]);

/**
 * REQUEST-SPECIFIC headers describe *one particular request or session*
 * (which conversation it belonged to, how many retries it had, its timeout,
 * billing annotations). Replaying these globally was the P1-06 finding:
 * every bridge caller inherited another session's state. They are still
 * captured (the billing header feeds getLiveSystemBlocks, and keeping the
 * capture set stable helps debugging), but they are never replayed as raw
 * headers on outgoing requests.
 */
const REQUEST_SPECIFIC_HEADERS = new Set([
  'x-claude-code-session-id',
  'x-anthropic-billing-header',
  'x-stainless-retry-count',
  'x-stainless-timeout',
  'x-stainless-variant',
  'x-stainless-stream-helper',
]);

/**
 * `anthropic-beta` is mixed: some flags are stable client identity
 * (claude-code, oauth) and some describe the *shape of one request*
 * (context-1m marks a long-context request; fallback-credit is a billing
 * behavior opt-in). Request-shape flags are stripped before replay so a
 * small runner request is not mislabeled as, say, a 1M-context request.
 * Prefix matching survives Anthropic rotating the date suffix.
 */
const REQUEST_SHAPE_BETA_PREFIXES = ['context-1m-', 'fallback-credit-'];

/**
 * Headers we want to capture from Claude Code's outgoing requests.
 * This is a strict whitelist — only these headers are captured.
 * No auth tokens, cookies, or internal headers can leak through.
 * Replay is further restricted: see buildAdaptiveAuthHeaders.
 */
const CAPTURED_HEADERS = new Set([...STABLE_IDENTITY_HEADERS, ...REQUEST_SPECIFIC_HEADERS, 'anthropic-beta']);

/**
 * Drop request-shape beta flags from a comma-separated anthropic-beta list.
 *
 * @param {string} value - Raw anthropic-beta header value
 * @returns {string|null} - Sanitized list, or null if nothing stable remains
 */
function sanitizeBetaList(value) {
  if (typeof value !== 'string') return null;
  const kept = value
    .split(',')
    .map((flag) => flag.trim())
    .filter((flag) => flag.length > 0)
    .filter((flag) => !REQUEST_SHAPE_BETA_PREFIXES.some((prefix) => flag.startsWith(prefix)));
  return kept.length > 0 ? kept.join(',') : null;
}

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
    // The playground is OAuth-only. If a caller accidentally passes API-key
    // credentials into this helper, do not turn them into upstream auth.
    return headers;
  }

  if (creds.accessToken) {
    headers['authorization'] = `Bearer ${creds.accessToken}`;

    // Use live fingerprint if available.
    // P1-06 containment: only STABLE identity headers are replayed.
    // Request-specific captured values (session id, retry count, timeout,
    // billing header, stream/variant markers) stay in ctx for diagnostics
    // and system-block use, but must never ride along on other requests.
    const fp = ctx.liveFingerprint;
    if (fp) {
      for (const [key, value] of Object.entries(fp)) {
        // Skip non-header bookkeeping fields stored on the fingerprint.
        if (key === 'endpoint' || key === 'messagesPath') continue;
        if (REQUEST_SPECIFIC_HEADERS.has(key)) continue;
        if (key === 'anthropic-beta') {
          // Strip request-shape beta flags (e.g. context-1m) before replay.
          const sanitized = sanitizeBetaList(value);
          if (sanitized) headers[key] = sanitized;
          continue;
        }
        headers[key] = value;
      }
    } else {
      // Fall back to the latest known Claude Code header fingerprint.
      // Captured from Claude Code 2.1.203 on 2026-07-07. The pinned version
      // metadata is stale relative to the currently installed CLI; refreshing
      // it needs a live capture/canary and is tracked as P1-06 follow-up,
      // not guessed here.
      //
      // P1-06 containment: the fallback no longer fabricates request-specific
      // state (no session id, no retry-count, no timeout) and no longer opts
      // every request into request-shape betas (context-1m, fallback-credit).
      headers['accept'] = 'application/json';
      headers['anthropic-beta'] =
        'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,mid-conversation-system-2026-04-07,effort-2025-11-24';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      headers['user-agent'] = 'claude-cli/2.1.203 (external, sdk-cli)';
      headers['x-app'] = 'cli';
      headers['x-stainless-arch'] = 'arm64';
      headers['x-stainless-lang'] = 'js';
      headers['x-stainless-os'] = 'MacOS';
      headers['x-stainless-package-version'] = '0.94.0';
      headers['x-stainless-runtime'] = 'node';
      // This is Claude Code's captured runtime, not this bridge process's runtime.
      headers['x-stainless-runtime-version'] = 'v26.3.0';
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
  sanitizeBetaList,
  CAPTURED_HEADERS,
  STABLE_IDENTITY_HEADERS,
  REQUEST_SPECIFIC_HEADERS,
  REQUEST_SHAPE_BETA_PREFIXES,
};
