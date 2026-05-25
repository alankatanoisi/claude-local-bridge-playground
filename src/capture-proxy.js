'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { log } = require('./utils');

// ─────────────────────────────────────────────
// Auth Capture Proxy
//
// Claude Code can be launched with:
//   HTTPS_PROXY=http://localhost:11439
//
// This local proxy then sees the CONNECT target, and for plain HTTP proxy
// requests it can also see OAuth request headers before forwarding upstream.
// It is intentionally narrow: Claude/Anthropic hosts only, OAuth Bearer only.
// ─────────────────────────────────────────────

const ANTHROPIC_HOSTNAMES = new Set(['api.anthropic.com', 'claude.ai', 'api.claude.ai']);

function normalizeHostname(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

function isAllowedProxyTarget(hostname) {
  // This proxy exists only to watch Claude/Anthropic traffic.
  // If it forwards every hostname, any local app could use it as a general
  // internet proxy. The allowlist keeps the proxy's job narrow.
  return ANTHROPIC_HOSTNAMES.has(normalizeHostname(hostname));
}

function fingerprintSecret(secret) {
  if (!secret) return null;

  // Stable label for comparing tokens without logging the token itself.
  return `sha256:${crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)}`;
}

function captureAuthFromHeaders(ctx, headers, host, port) {
  if (!headers) return;

  const auth = headers.authorization || headers.Authorization;
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) !== ctx.interceptedToken) {
    const token = auth.slice(7);
    const wasEmpty = !ctx.interceptedToken;
    ctx.interceptedToken = token;
    ctx.interceptedHeaderType = 'bearer';
    ctx.interceptedSource = 'proxy:bearer';
    ctx.rejectedInterceptedToken = null;
    ctx.rejectedInterceptedAt = 0;
    ctx.interceptedHost = host;
    ctx.interceptedPort = port || 443;
    ctx.cachedCredentials = null;
    ctx.credentialsCachedAt = 0;
    const fingerprint = fingerprintSecret(token);
    log(
      ctx,
      wasEmpty
        ? `🔑 [PROXY] Captured Claude Code OAuth from ${host}: ${fingerprint}`
        : `🔑 [PROXY] OAuth rotated from ${host}: ${fingerprint}`,
    );
  }
}

function startCaptureProxy(ctx) {
  const proxyPort = 11439;

  if (ctx.captureProxy) stopCaptureProxy(ctx);

  ctx.captureProxy = http.createServer((req, res) => {
    handleProxyRequest(ctx, req, res);
  });

  ctx.captureProxy.on('connect', (req, clientSocket, head) => {
    handleConnect(ctx, req, clientSocket, head);
  });

  ctx.captureProxy.listen(proxyPort, '127.0.0.1', () => {
    log(ctx, `🔌 Auth capture proxy running on http://localhost:${proxyPort}`);
    log(ctx, `   Set HTTPS_PROXY=http://localhost:${proxyPort} in Claude Code's environment`);
  });

  ctx.captureProxy.on('error', (err) => {
    log(ctx, `⚠️ Capture proxy error: ${err.message}`, true);
  });
}

function stopCaptureProxy(ctx) {
  if (ctx.captureProxy) {
    ctx.captureProxy.close(() => {
      ctx.captureProxy = null;
    });
  }
}

function handleProxyRequest(ctx, req, res) {
  let targetUrl;
  try {
    targetUrl = new URL(req.url);
  } catch {
    const host = req.headers.host;
    if (host) {
      targetUrl = new URL(`https://${host}${req.url}`);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing target URL' }));
      return;
    }
  }

  const host = normalizeHostname(targetUrl.hostname);
  if (!isAllowedProxyTarget(host)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy target not allowed' }));
    return;
  }

  // Capture OAuth if the request is visible. API keys are ignored on purpose.
  captureAuthFromHeaders(ctx, req.headers, host, targetUrl.port);

  const bodylessHeaders = { ...req.headers, host };
  const options = {
    hostname: host,
    port: targetUrl.port || 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: bodylessHeaders,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    log(ctx, `Proxy forward error: ${err.message}`, true);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  req.pipe(proxyReq);
}

function handleConnect(ctx, req, clientSocket, head) {
  const { hostname, port } = parseHost(req.url);
  const normalizedHostname = normalizeHostname(hostname);

  if (!isAllowedProxyTarget(normalizedHostname)) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.end();
    return;
  }

  // CONNECT creates a raw TCP tunnel for HTTPS. The bytes inside are encrypted,
  // so we cannot read request headers from it without becoming a MITM proxy.
  log(ctx, `🔌 [PROXY] CONNECT tunnel to ${normalizedHostname}:${port}`);

  const upstreamSocket = net.connect({
    host: normalizedHostname,
    port: port || 443,
  });

  upstreamSocket.on('connect', () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    if (head && head.length > 0) {
      upstreamSocket.write(head);
    }

    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);

    upstreamSocket.on('error', (err) => {
      log(ctx, `Proxy socket error: ${err.message}`, true);
      clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      log(ctx, `Client socket error: ${err.message}`, true);
      upstreamSocket.end();
    });
  });

  upstreamSocket.on('error', (err) => {
    log(ctx, `CONNECT error: ${err.message}`, true);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.end();
  });
}

function parseHost(hostStr) {
  const [hostname, port] = hostStr.split(':');
  return { hostname, port: port ? parseInt(port, 10) : 443 };
}

module.exports = { startCaptureProxy, stopCaptureProxy, isAllowedProxyTarget };
