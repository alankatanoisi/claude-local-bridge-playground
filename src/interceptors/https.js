'use strict';

const https = require('https');
const { log } = require('../utils');
const { extractFingerprint, updateFingerprint } = require('../fingerprint');

// ─────────────────────────────────────────────
// HTTPS + Fetch Interceptor — Auth + Endpoint + Fingerprint Sniffer
//
// Patches both https.request() and globalThis.fetch to observe every
// outgoing HTTPS call made by any VS Code extension in this process.
// When Claude Code makes a request to an Anthropic endpoint, we capture:
//   • The auth header (Bearer token or x-api-key)
//   • The exact target hostname Claude Code is actually calling
//   • The full request fingerprint (user-agent, stainless headers, etc.)
//
// WHY capture the endpoint too:
//   Claude Code may not call api.anthropic.com directly — it might route
//   through claude.ai/api or another internal gateway. By capturing the
//   actual URL, we proxy requests to wherever Claude Code really goes,
//   just like ag-local-bridge routes through Antigravity's sidecar rather
//   than directly to Google AI.
//
// WHY capture the fingerprint:
//   Claude Code's request headers (user-agent, billing header, beta flags)
//   change with each version. By capturing them live, the bridge becomes
//   self-adapting instead of relying on hardcoded values that rot.
//
// NOTE: The Anthropic SDK uses fetch() by default, not https.request,
// so both interceptors are needed.
// ─────────────────────────────────────────────

const ANTHROPIC_HOSTNAMES = new Set(['api.anthropic.com', 'claude.ai', 'api.claude.ai']);

function extractAuthFromHeaders(headers) {
  if (!headers) return null;

  // Handle Headers object (fetch API)
  if (typeof headers?.entries === 'function') {
    const entries = Object.fromEntries(headers.entries());
    return extractAuthFromHeaders(entries);
  }

  // Handle array of [key, value] pairs (fetch API internal)
  if (Array.isArray(headers)) {
    return extractAuthFromHeaders(Object.fromEntries(headers));
  }

  const apiKey = headers['x-api-key'] || headers['X-Api-Key'];
  if (apiKey) return { token: apiKey, headerType: 'api-key', source: 'intercepted:x-api-key' };

  const auth = headers['authorization'] || headers['Authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return { token: auth.slice(7), headerType: 'bearer', source: 'intercepted:bearer' };
  }

  return null;
}

function captureAuth(ctx, url, headers) {
  try {
    let host, port;

    if (typeof url === 'string') {
      const u = new URL(url);
      host = u.hostname;
      port = u.port ? parseInt(u.port) : 443;
    } else if (url instanceof URL) {
      host = url.hostname;
      port = url.port ? parseInt(url.port) : 443;
    }

    if (host && ANTHROPIC_HOSTNAMES.has(host)) {
      // Capture full fingerprint
      const fingerprint = extractFingerprint(headers);
      if (fingerprint) {
        fingerprint.endpoint = { hostname: host, port };
        // Extract path from URL for messages path discovery
        if (typeof url === 'string') {
          try {
            const u = new URL(url);
            fingerprint.messagesPath = u.pathname + u.search;
          } catch {
            // URL parsing failed — skip messages path capture
          }
        }
        updateFingerprint(ctx, fingerprint);
      }

      const cred = extractAuthFromHeaders(headers);
      if (cred && cred.token !== ctx.interceptedToken) {
        const wasEmpty = !ctx.interceptedToken;
        ctx.interceptedToken = cred.token;
        ctx.interceptedHeaderType = cred.headerType;
        ctx.interceptedSource = cred.source;

        // Store the exact host Claude Code is calling so proxy.js mirrors it
        ctx.interceptedHost = host;
        ctx.interceptedPort = port;

        // Clear credential cache so next bridge request picks up the fresh token
        ctx.cachedCredentials = null;
        ctx.credentialsCachedAt = 0;

        const preview = cred.token.slice(0, 8) + '...' + cred.token.slice(-4);
        log(
          ctx,
          wasEmpty
            ? `🔑 [INTERCEPT] Captured Claude Code auth from ${host} (${cred.source}): ${preview}`
            : `🔑 [INTERCEPT] Auth rotated from ${host} (${cred.source}): ${preview}`,
        );
        log(ctx, `🔍 [FINGERPRINT] Captured ${Object.keys(fingerprint || {}).length} header values from ${host}`);
      }
    }
  } catch {
    /* never break the original call */
  }
}

function createInterceptedFetch(ctx) {
  return async function interceptedFetch(input, init) {
    let url = input;
    let headers = init?.headers;

    if (input instanceof Request) {
      url = input.url;
      headers = input.headers;
    } else if (typeof input === 'object' && input !== null && 'url' in input) {
      url = input.url;
      headers = input.headers;
    }

    captureAuth(ctx, url, headers);

    return ctx._originalFetch.call(globalThis, input, init);
  };
}

function createInterceptedRequest(ctx) {
  return function interceptedRequest(optionsOrUrl, optionsOrCb, ...rest) {
    try {
      let host, port, rawHeaders;

      if (typeof optionsOrUrl === 'string' || optionsOrUrl instanceof URL) {
        const u = new URL(optionsOrUrl.toString());
        host = u.hostname;
        port = u.port ? parseInt(u.port) : 443;
        // second arg may be options object or callback
        rawHeaders = optionsOrCb && typeof optionsOrCb === 'object' ? optionsOrCb.headers : null;
      } else if (optionsOrUrl && typeof optionsOrUrl === 'object') {
        host = optionsOrUrl.hostname || optionsOrUrl.host || '';
        port = parseInt(optionsOrUrl.port) || 443;
        rawHeaders = optionsOrUrl.headers;
      }

      if (host && ANTHROPIC_HOSTNAMES.has(host)) {
        const cred = extractAuthFromHeaders(rawHeaders);
        if (cred && cred.token !== ctx.interceptedToken) {
          const wasEmpty = !ctx.interceptedToken;
          ctx.interceptedToken = cred.token;
          ctx.interceptedHeaderType = cred.headerType;
          ctx.interceptedSource = cred.source;

          // Store the exact host Claude Code is calling so proxy.js mirrors it
          ctx.interceptedHost = host;
          ctx.interceptedPort = port;

          // Clear credential cache so next bridge request picks up the fresh token
          ctx.cachedCredentials = null;
          ctx.credentialsCachedAt = 0;

          const preview = cred.token.slice(0, 8) + '...' + cred.token.slice(-4);
          log(
            ctx,
            wasEmpty
              ? `🔑 [INTERCEPT] Captured Claude Code auth from ${host} (${cred.source}): ${preview}`
              : `🔑 [INTERCEPT] Auth rotated from ${host} (${cred.source}): ${preview}`,
          );
        }
      }
    } catch {
      /* never break the original call */
    }

    return ctx._originalHttpsRequest.call(this, optionsOrUrl, optionsOrCb, ...rest);
  };
}

function install(ctx) {
  // Patch https.request
  ctx._originalHttpsRequest = https.request;
  ctx._interceptedRequest = createInterceptedRequest(ctx);
  https.request = ctx._interceptedRequest;
  log(ctx, '🔌 HTTPS interceptor installed (watching Anthropic endpoints)');

  // Patch globalThis.fetch (used by Anthropic SDK)
  if (typeof globalThis.fetch === 'function') {
    ctx._originalFetch = globalThis.fetch;
    ctx._interceptedFetch = createInterceptedFetch(ctx);
    globalThis.fetch = ctx._interceptedFetch;
    log(ctx, '🔌 Fetch interceptor installed (watching Anthropic endpoints)');
  }
}

function uninstall(ctx) {
  if (ctx._originalHttpsRequest && https.request === ctx._interceptedRequest) {
    https.request = ctx._originalHttpsRequest;
  }
  ctx._originalHttpsRequest = null;
  ctx._interceptedRequest = null;

  if (ctx._originalFetch && globalThis.fetch === ctx._interceptedFetch) {
    globalThis.fetch = ctx._originalFetch;
  }
  ctx._originalFetch = null;
  ctx._interceptedFetch = null;

  log(ctx, '🔌 Interceptors removed');
}

module.exports = { install, uninstall };
