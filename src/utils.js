'use strict';

const vscode = require('vscode');

// ─────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────

function log(ctx, msg, isError = false) {
  if (typeof msg === 'object') {
    try {
      msg = JSON.stringify(msg);
    } catch {
      msg = String(msg);
    }
  }
  const ts = new Date().toISOString().slice(11, 23);
  if (ctx.outputChannel) ctx.outputChannel.appendLine(`[${ts}] ${msg}`);
  if (isError) console.error(`[claude-bridge] ${msg}`);
}

/** Log only when claudeLocalBridge.logRequests is enabled */
function verboseLog(ctx, msg) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  if (config.get('logRequests', false)) {
    log(ctx, msg);
  }
}

// ─────────────────────────────────────────────
// Status Bar
// ─────────────────────────────────────────────

function updateStatusBar(ctx, running, port, credSource) {
  if (!ctx.statusBarItem) return;
  if (running) {
    const icon = '$(radio-tower)';
    const src = credSource ? ` [${credSource}]` : '';
    ctx.statusBarItem.text = `${icon} Claude Bridge :${port}${src}`;
    ctx.statusBarItem.backgroundColor = undefined;
  } else {
    ctx.statusBarItem.text = '$(warning) Claude Bridge OFF';
    ctx.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  ctx.statusBarItem.show();
}

// ─────────────────────────────────────────────
// HTTP Response Helpers
// ─────────────────────────────────────────────

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(code);
  res.end(body);
}

function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', (c) => {
      totalBytes += c.length;
      if (totalBytes > maxBytes) {
        req.destroy(new Error(`Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ─────────────────────────────────────────────
// OpenAI Response Builders (for /v1/chat/completions)
// ─────────────────────────────────────────────

function buildStreamChunk(id, model, content, finishReason = null) {
  const delta = content !== null ? { role: 'assistant', content } : {};
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function buildCompletion(id, model, content) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

module.exports = {
  log,
  verboseLog,
  updateStatusBar,
  sendJson,
  readBody,
  buildStreamChunk,
  buildCompletion,
};
