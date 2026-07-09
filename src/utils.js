'use strict';

const vscode = require('vscode');

// ─────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────

function padNumber(value, width) {
  return String(value).padStart(width, '0');
}

function configuredLogTimeZone() {
  try {
    const config = vscode.workspace.getConfiguration('claudeLocalBridge');
    return config.get('logTimeZone', 'local');
  } catch {
    return 'local';
  }
}

function normalizeLogTimeZone(value) {
  const raw = String(value || 'local').trim();
  if (!raw) return 'local';

  const lower = raw.toLowerCase();
  if (lower === 'local' || lower === 'system') return 'local';
  if (lower === 'utc') return 'UTC';
  return raw;
}

function formatLocalTimestamp(date) {
  return (
    padNumber(date.getHours(), 2) +
    ':' +
    padNumber(date.getMinutes(), 2) +
    ':' +
    padNumber(date.getSeconds(), 2) +
    '.' +
    padNumber(date.getMilliseconds(), 3)
  );
}

function formatTimestampInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return values.hour + ':' + values.minute + ':' + values.second + '.' + padNumber(date.getMilliseconds(), 3);
}

function formatLogTimestamp(date = new Date(), configuredTimeZone = configuredLogTimeZone()) {
  // A timezone is the rule that turns one exact moment into the clock time for
  // a place. "local" asks JavaScript to use the same timezone as this VS Code
  // process, which normally follows the Mac's system timezone.
  const timeZone = normalizeLogTimeZone(configuredTimeZone);
  if (timeZone === 'local') return formatLocalTimestamp(date);

  try {
    // IANA names are standard timezone names like "America/Los_Angeles".
    return formatTimestampInTimeZone(date, timeZone);
  } catch {
    return formatLocalTimestamp(date);
  }
}

function log(ctx, msg, isError = false) {
  if (typeof msg === 'object') {
    try {
      msg = JSON.stringify(msg);
    } catch {
      msg = String(msg);
    }
  }
  const ts = formatLogTimestamp();
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

module.exports = {
  formatLogTimestamp,
  log,
  verboseLog,
  updateStatusBar,
  sendJson,
  readBody,
};
