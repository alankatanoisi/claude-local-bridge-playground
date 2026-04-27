'use strict';

const http = require('http');
const https = require('https');
const { log } = require('./utils');

// ─────────────────────────────────────────────
// Auth Capture Proxy
//
// A lightweight HTTP proxy that Claude Code routes through via
// HTTPS_PROXY=http://localhost:<port>. When Claude Code makes requests,
// we capture the auth token and endpoint, then forward the request.
//
// This works because Claude Code respects HTTPS_PROXY and sends its
// requests through it. We intercept, capture, and forward.
// ─────────────────────────────────────────────

const ANTHROPIC_HOSTNAMES = new Set(['api.anthropic.com', 'claude.ai', 'api.claude.ai']);

function captureAuthFromHeaders(ctx, headers, host, port) {
  if (!headers) return;

  const apiKey = headers['x-api-key'] || headers['X-Api-Key'];
  if (apiKey && apiKey !== ctx.interceptedToken) {
    const wasEmpty = !ctx.interceptedToken;
    ctx.interceptedToken = apiKey;
    ctx.interceptedHeaderType = 'api-key';
    ctx.interceptedSource = 'proxy:x-api-key';
    ctx.interceptedHost = host;
    ctx.interceptedPort = port || 443;
    ctx.cachedCredentials = null;
    ctx.credentialsCachedAt = 0;
    const preview = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);
    log(
      ctx,
      wasEmpty
        ? `🔑 [PROXY] Captured API key from ${host}: ${preview}`
        : `🔑 [PROXY] Auth rotated from ${host}: ${preview}`,
    );
    return;
  }

  const auth = headers['authorization'] || headers['Authorization'];
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) !== ctx.interceptedToken) {
    const token = auth.slice(7);
    const wasEmpty = !ctx.interceptedToken;
    ctx.interceptedToken = token;
    ctx.interceptedHeaderType = 'bearer';
    ctx.interceptedSource = 'proxy:bearer';
    ctx.interceptedHost = host;
    ctx.interceptedPort = port || 443;
    ctx.cachedCredentials = null;
    ctx.credentialsCachedAt = 0;
    const preview = token.slice(0, 8) + '...' + token.slice(-4);
    log(
      ctx,
      wasEmpty
        ? `🔑 [PROXY] Captured Bearer token from ${host}: ${preview}`
        : `🔑 [PROXY] Auth rotated from ${host}: ${preview}`,
    );
  }
}

function startCaptureProxy(ctx) {
  const proxyPort = 11439;

  if (ctx.captureProxy) stopCaptureProxy(ctx);

  ctx.captureProxy = http.createServer((req, res) => {
    // Regular HTTP proxy for non-CONNECT requests
    handleProxyRequest(ctx, req, res);
  });

  ctx.captureProxy.on('connect', (req, clientSocket, head) => {
    // CONNECT tunnel for HTTPS
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
  // Extract target from the request URL (absolute URL in proxy mode)
  let targetUrl;
  try {
    targetUrl = new URL(req.url);
  } catch {
    // Fall back to Host header
    const host = req.headers['host'];
    if (host) {
      targetUrl = new URL(`https://${host}${req.url}`);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing target URL' }));
      return;
    }
  }

  const host = targetUrl.hostname;

  // Capture auth if targeting Anthropic
  if (ANTHROPIC_HOSTNAMES.has(host)) {
    captureAuthFromHeaders(ctx, req.headers, host, targetUrl.port);
  }

  // Forward the request
  const options = {
    hostname: host,
    port: targetUrl.port || 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: { ...req.headers, host },
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

  // Capture auth info from CONNECT target
  if (ANTHROPIC_HOSTNAMES.has(hostname)) {
    log(ctx, `🔌 [PROXY] CONNECT tunnel to ${hostname}:${port}`);
  }

  const proxyReq = https.connect({
    host: hostname,
    port: port || 443,
  });

  proxyReq.on('connect', (proxyRes, proxySocket) => {
    // Establish tunnel
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    // Pipe data bidirectionally
    proxySocket.on('data', (data) => clientSocket.write(data));
    clientSocket.on('data', (data) => {
      // Try to capture auth from the first request in the tunnel
      if (ANTHROPIC_HOSTNAMES.has(hostname) && !ctx.interceptedToken) {
        const text = data.toString('utf8', 0, Math.min(data.length, 8192));
        const authMatch = text.match(/authorization:\s*bearer\s*([^\r\n]+)/i);
        const keyMatch = text.match(/x-api-key:\s*([^\r\n]+)/i);
        if (authMatch) {
          captureAuthFromHeaders(ctx, { authorization: `Bearer ${authMatch[1].trim()}` }, hostname, port);
        } else if (keyMatch) {
          captureAuthFromHeaders(ctx, { 'x-api-key': keyMatch[1].trim() }, hostname, port);
        }
      }
      proxySocket.write(data);
    });

    proxySocket.on('error', (err) => {
      log(ctx, `Proxy socket error: ${err.message}`, true);
      clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      log(ctx, `Client socket error: ${err.message}`, true);
      proxySocket.end();
    });
  });

  proxyReq.on('error', (err) => {
    log(ctx, `CONNECT error: ${err.message}`, true);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.end();
  });

  if (head && head.length > 0) {
    proxyReq.write(head);
  }
}

function parseHost(hostStr) {
  const [hostname, port] = hostStr.split(':');
  return { hostname, port: port ? parseInt(port) : 443 };
}

module.exports = { startCaptureProxy, stopCaptureProxy };
