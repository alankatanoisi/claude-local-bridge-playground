'use strict';

const https = require('https');
const { URL } = require('url');
const vscode = require('vscode');
const { getCredentials, clearCredentialsCache, buildAuthHeaders } = require('./credentials');
const { log, verboseLog } = require('./utils');

// Reuse a single keep-alive agent so repeated tool-use loops do not pay for a
// fresh TLS handshake every time. This matters most when the bridge is hit many
// times in a row during an agent run.
const sharedAgent = new https.Agent({ keepAlive: true, maxSockets: 6 });

// ─────────────────────────────────────────────
// Core Proxy
// Forwards a request to api.anthropic.com and pipes
// the response (streaming or buffered) back to the caller.
// ─────────────────────────────────────────────

/**
 * Proxy a request to the Anthropic API.
 *
 * Headers are intentionally deferred until the upstream response is known.
 * That keeps the retry path clean: if the first upstream response is a 401,
 * the bridge can retry without having already committed headers to the client.
 *
 * @param {object} ctx Bridge context
 * @param {object} res Node.js ServerResponse to write into
 * @param {string} apiPath e.g. '/v1/messages'
 * @param {string} bodyStr JSON body string
 * @param {boolean} [retry] Internal — true when retrying after a 401
 * @returns {Promise<void>}
 */
async function proxyToAnthropic(ctx, res, apiPath, bodyStr, retry = false) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const configuredBaseUrl = config.get('anthropicBaseUrl', 'https://api.anthropic.com');

  // Prefer the host we observed Claude Code actually calling so the bridge can
  // stay aligned with the real official client path.
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
    agent: sharedAgent,
    headers: {
      ...authHeaders,
      'content-length': bodyBuf.length,
    },
    timeout: 300_000,
  };

  return new Promise((resolve, reject) => {
    const upReq = https.request(reqOptions, (upRes) => {
      verboseLog(ctx, `← ${upRes.statusCode} ${url.pathname}`);

      // On 401, force a fresh credential lookup and retry once. Destroying the
      // upstream response is deliberate here: we do not want to keep reading a
      // failed body when the right next action is a new authenticated request.
      if (upRes.statusCode === 401 && !retry) {
        log(ctx, '⚠️ Received 401 — clearing credential cache and retrying');
        clearCredentialsCache(ctx);
        if (typeof upRes.destroy === 'function') {
          upRes.destroy();
        } else if (typeof upRes.resume === 'function') {
          // Some tests use a lightweight mocked response object that only
          // supports resume(). Falling back keeps the retry semantics intact.
          upRes.resume();
        }
        proxyToAnthropic(ctx, res, apiPath, bodyStr, true).then(resolve).catch(reject);
        return;
      }

      // If a retry path somehow already committed headers, stop here instead of
      // double-writing a second response shape into the same client stream.
      if (retry && res.headersSent) {
        log(ctx, '⚠️ Headers already sent — cannot forward retried response');
        if (typeof upRes.destroy === 'function') {
          upRes.destroy();
        } else if (typeof upRes.resume === 'function') {
          upRes.resume();
        }
        resolve();
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
