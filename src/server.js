'use strict';

const vscode = require('vscode');
const http = require('http');
const { log, sendJson, updateStatusBar } = require('./utils');
const { handleModels } = require('./handlers/models');
const { handleAnthropicMessages, handleCountTokens } = require('./handlers/anthropic');
const { handleChatCompletions } = require('./handlers/openai');
const { handleDebug } = require('./handlers/debug');
const { getCredentials } = require('./credentials');

// ─────────────────────────────────────────────
// HTTP Server
// ─────────────────────────────────────────────

async function startServer(ctx) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const basePort = config.get('port', 11436);

  if (ctx.server) await stopServer(ctx);

  ctx.server = http.createServer((req, res) => {
    handleRequest(ctx, req, res).catch((err) => {
      log(ctx, `Request error: ${err.message}`, true);
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: err.message, type: 'internal_error' } });
      } else if (!res.writableEnded) {
        res.write(`data: {"error": "${err.message.replace(/"/g, '\\"')}"}\n\ndata: [DONE]\n\n`);
        res.end();
      }
    });
  });

  ctx.server.timeout = 0;
  ctx.server.keepAliveTimeout = 0;

  let bound = false;
  const maxRetries = 10;

  for (let offset = 0; offset <= maxRetries; offset++) {
    const port = basePort + offset;
    try {
      await new Promise((resolve, reject) => {
        function onError(err) {
          if (err.code === 'EADDRINUSE') resolve(false);
          else reject(err);
        }
        ctx.server.once('error', onError);
        ctx.server.listen(port, '127.0.0.1', () => {
          ctx.server.removeListener('error', onError);
          const creds = getCredentials(ctx);
          log(ctx, `✅ Server running on http://localhost:${port}  [${creds.source}]`);
          updateStatusBar(ctx, true, port, creds.source);
          resolve(true);
        });
      });

      if (ctx.server.listening) {
        bound = true;
        ctx.server.on('error', (err) => {
          log(ctx, `❌ Server runtime error: ${err.message}`, true);
          updateStatusBar(ctx, false);
        });
        break;
      }
    } catch (err) {
      log(ctx, `❌ Server startup failed: ${err.message}`, true);
      updateStatusBar(ctx, false);
      throw err;
    }
  }

  if (!bound) {
    const errMsg = `listen EADDRINUSE: Exhausted ${maxRetries} sequential ports starting at ${basePort}`;
    log(ctx, `❌ Server failed: ${errMsg}`, true);
    updateStatusBar(ctx, false);
    throw new Error(errMsg);
  }
}

function stopServer(ctx) {
  return new Promise((resolve) => {
    if (!ctx.server) {
      resolve();
      return;
    }
    ctx.server.close(() => {
      ctx.server = null;
      updateStatusBar(ctx, false);
      resolve();
    });
  });
}

// ─────────────────────────────────────────────
// Request Router
// ─────────────────────────────────────────────

function isLocalhostOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

async function handleRequest(ctx, req, res) {
  const origin = req.headers['origin'];
  if (origin) {
    if (!isLocalhostOrigin(origin)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Forbidden: Invalid Origin', type: 'forbidden' } }));
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta, x-goog-api-key',
    );
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  // ── Model listing ──
  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    return handleModels(ctx, req, res);
  }

  // ── OpenAI Chat Completions ──
  if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
    return handleChatCompletions(ctx, req, res);
  }

  // ── Anthropic Messages ──
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    return handleAnthropicMessages(ctx, req, res);
  }

  // ── Anthropic count_tokens preflight ──
  if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') {
    return handleCountTokens(ctx, req, res);
  }

  // ── Debug ──
  if (req.method === 'GET' && url.pathname === '/v1/debug') {
    return handleDebug(ctx, req, res);
  }

  sendJson(res, 404, {
    error: { message: `Unknown: ${req.method} ${url.pathname}`, type: 'not_found' },
  });
}

module.exports = { startServer, stopServer, isLocalhostOrigin };
