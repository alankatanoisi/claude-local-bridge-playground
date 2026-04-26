'use strict';

const https = require('https');
const { log } = require('../utils');

// ─────────────────────────────────────────────
// HTTPS Interceptor — Auth + Endpoint Sniffer
//
// Patches https.request to observe every outgoing HTTPS call made by any
// VS Code extension in this process. When Claude Code makes a request to
// an Anthropic endpoint, we capture:
//   • The auth header (Bearer token or x-api-key)
//   • The exact target hostname Claude Code is actually calling
//
// WHY capture the endpoint too:
//   Claude Code may not call api.anthropic.com directly — it might route
//   through claude.ai/api or another internal gateway. By capturing the
//   actual URL, we proxy requests to wherever Claude Code really goes,
//   just like ag-local-bridge routes through Antigravity's sidecar rather
//   than directly to Google AI.
// ─────────────────────────────────────────────

const ANTHROPIC_HOSTNAMES = new Set(['api.anthropic.com', 'claude.ai', 'api.claude.ai']);

function extractAuthFromHeaders(headers) {
  if (!headers) return null;

  const apiKey = headers['x-api-key'] || headers['X-Api-Key'];
  if (apiKey) return { token: apiKey, headerType: 'api-key', source: 'intercepted:x-api-key' };

  const auth = headers['authorization'] || headers['Authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    return { token: auth.slice(7), headerType: 'bearer', source: 'intercepted:bearer' };
  }

  return null;
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
  ctx._originalHttpsRequest = https.request;
  ctx._interceptedRequest = createInterceptedRequest(ctx);
  https.request = ctx._interceptedRequest;
  log(ctx, '🔌 HTTPS interceptor installed (watching Anthropic endpoints)');
}

function uninstall(ctx) {
  if (ctx._originalHttpsRequest && https.request === ctx._interceptedRequest) {
    https.request = ctx._originalHttpsRequest;
  }
  ctx._originalHttpsRequest = null;
  ctx._interceptedRequest = null;
  log(ctx, '🔌 HTTPS interceptor removed');
}

module.exports = { install, uninstall };
