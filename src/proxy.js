'use strict';

const https = require('https');
const { URL } = require('url');
const vscode = require('vscode');
const { getCredentials, clearCredentialsCache, buildAuthHeaders } = require('./credentials');
const { log, verboseLog } = require('./utils');

// ─────────────────────────────────────────────
// Core Proxy
// Forwards a request to api.anthropic.com and pipes
// the response (streaming or buffered) back to the caller.
// ─────────────────────────────────────────────

/**
 * Proxy a request to the Anthropic API.
 *
 * @param {object}    ctx        Bridge context
 * @param {object}    res        Node.js ServerResponse to write into
 * @param {string}    apiPath    e.g. '/v1/messages'
 * @param {string}    bodyStr    JSON body string
 * @param {boolean}   [retry]    Internal — true when retrying after a 401
 * @returns {Promise<void>}
 */
async function proxyToAnthropic(ctx, res, apiPath, bodyStr, retry = false) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const configuredBaseUrl = config.get('anthropicBaseUrl', 'https://api.anthropic.com');

  // Prefer the host we observed Claude Code actually calling.
  // This mirrors ag-local-bridge's pattern: route through the same endpoint
  // the authenticated client uses, rather than assuming api.anthropic.com.
  const baseUrl = ctx.interceptedHost
    ? `https://${ctx.interceptedHost}${ctx.interceptedPort && ctx.interceptedPort !== 443 ? `:${ctx.interceptedPort}` : ''}`
    : configuredBaseUrl;

  const url = new URL(apiPath, baseUrl);
  const creds = getCredentials(ctx);
  const authHeaders = buildAuthHeaders(ctx, creds);

  verboseLog(ctx, `→ ${url.hostname}${url.pathname}  model=${tryExtractModel(bodyStr)}  source=${creds.source}`);

  const bodyBuf = Buffer.from(bodyStr, 'utf8');

  const reqOptions = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-length': bodyBuf.length,
    },
    timeout: 300_000,
  };

  return new Promise((resolve, reject) => {
    const upReq = https.request(reqOptions, (upRes) => {
      verboseLog(ctx, `← ${upRes.statusCode} ${url.pathname}`);

      // On 401: clear cache and retry once
      if (upRes.statusCode === 401 && !retry) {
        log(ctx, '⚠️ Received 401 — clearing credential cache and retrying');
        clearCredentialsCache(ctx);
        // Drain the upstream body before retrying
        upRes.resume();
        proxyToAnthropic(ctx, res, apiPath, bodyStr, true).then(resolve).catch(reject);
        return;
      }

      // Forward status and headers verbatim
      const forwardHeaders = {};
      const passthroughHeaders = [
        'content-type',
        'x-request-id',
        'anthropic-ratelimit-requests-limit',
        'anthropic-ratelimit-requests-remaining',
        'anthropic-ratelimit-requests-reset',
        'anthropic-ratelimit-tokens-limit',
        'anthropic-ratelimit-tokens-remaining',
        'anthropic-ratelimit-tokens-reset',
      ];
      for (const h of passthroughHeaders) {
        if (upRes.headers[h]) forwardHeaders[h] = upRes.headers[h];
      }

      if (!res.headersSent) {
        res.writeHead(upRes.statusCode, forwardHeaders);
      }

      // Pipe upstream → client (true streaming, no buffering)
      upRes.on('data', (chunk) => {
        if (!res.writableEnded) res.write(chunk);
      });
      upRes.on('end', () => {
        if (!res.writableEnded) res.end();
        resolve();
      });
      upRes.on('error', (err) => {
        log(ctx, `Upstream response error: ${err.message}`, true);
        if (!res.writableEnded) res.end();
        resolve();
      });
    });

    upReq.on('error', (err) => {
      log(ctx, `Upstream request error: ${err.message}`, true);
      reject(err);
    });

    upReq.on('timeout', () => {
      log(ctx, 'Upstream request timed out', true);
      upReq.destroy(new Error('Upstream request timed out'));
    });

    upReq.write(bodyBuf);
    upReq.end();
  });
}

/** Best-effort: extract model name from a JSON body string for logging */
function tryExtractModel(bodyStr) {
  try {
    return JSON.parse(bodyStr).model || 'unknown';
  } catch {
    return 'unknown';
  }
}

module.exports = { proxyToAnthropic };
