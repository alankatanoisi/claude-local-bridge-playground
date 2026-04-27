'use strict';

/**
 * POST /v1/messages — Anthropic Messages API (native format)
 * POST /v1/messages/count_tokens — preflight mock for Claude CLI
 *
 * These are forwarded verbatim to api.anthropic.com.
 * The only transformation is model name resolution and injecting auth headers.
 */

const { readBody, sendJson, verboseLog, log } = require('../utils');
const { resolveModel } = require('../models');
const { proxyToAnthropic } = require('../proxy');
const { getCredentials, prependClaudeCodeSystem, messagesPathFor } = require('../credentials');

const vscode = require('vscode');

function dumpCapture(ctx, req, raw) {
  const cfg = vscode.workspace.getConfiguration('claudeLocalBridge');
  if (!cfg.get('logRequests', false)) return;
  const redacted = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.toLowerCase() === 'authorization' && typeof v === 'string') {
      redacted[k] = v.slice(0, 15) + '…REDACTED…' + v.slice(-4);
    } else if (k.toLowerCase() === 'x-api-key' && typeof v === 'string') {
      redacted[k] = v.slice(0, 8) + '…REDACTED…' + v.slice(-4);
    } else {
      redacted[k] = v;
    }
  }
  log(ctx, '─── CAPTURE: incoming /v1/messages ───');
  log(ctx, 'HEADERS: ' + JSON.stringify(redacted, null, 2));
  log(ctx, 'BODY: ' + raw);
  log(ctx, '─── END CAPTURE ───');
}

/**
 * POST /v1/messages
 */
async function handleAnthropicMessages(ctx, req, res) {
  const raw = await readBody(req);
  dumpCapture(ctx, req, raw);
  verboseLog(ctx, `→ /v1/messages body: ${raw.slice(0, 300)}`);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Invalid JSON body' } });
    return;
  }

  // Resolve model name (with alias table + passthrough)
  body.model = resolveModel(body.model, vscode);

  // Anthropic requires max_tokens — default if missing
  if (!body.max_tokens) body.max_tokens = 4096;

  // Reshape system field + pick path based on credential type.
  const creds = getCredentials(ctx);
  prependClaudeCodeSystem(body, creds);

  await proxyToAnthropic(ctx, res, messagesPathFor(creds), JSON.stringify(body));
}

/**
 * POST /v1/messages/count_tokens
 * Many Claude CLI tools (e.g. Claude Code itself) send this preflight.
 * Return a mock 0-token response so the client proceeds.
 */
function handleCountTokens(_ctx, _req, res) {
  sendJson(res, 200, { input_tokens: 0 });
}

module.exports = { handleAnthropicMessages, handleCountTokens };
