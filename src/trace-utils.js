'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const safety = require('./runner/safety');

const TRACE_LEVELS = new Set(['off', 'summary', 'redacted', 'full']);
const SENSITIVE_KEY_PATTERN =
  /authorization|x-api-key|cookie|(?:^|[_-])token(?:$|[_-])|secret|password|access[_-]?key/i;
const PREVIEW_BYTES = 20000;

function normalizeTraceLevel(level) {
  return TRACE_LEVELS.has(level) ? level : 'off';
}

function makeTraceId(value) {
  if (typeof value === 'string' && /^[a-zA-Z0-9_-]{8,120}$/.test(value)) return value;
  return randomUUID();
}

function sha256(value) {
  return createHash('sha256')
    .update(String(value || ''), 'utf8')
    .digest('hex');
}

function bytes(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value || null), 'utf8');
}

function defaultRunnerTracePath(runId, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(os.homedir(), '.bridge-runner', 'traces', stamp + '-' + runId + '.runner.jsonl');
}

function defaultBridgeTracePath(traceId) {
  return path.join(os.homedir(), '.claude-local-bridge', 'traces', traceId + '.bridge.jsonl');
}

// This redactor keeps a trace useful without writing common credentials to disk.
// The `full` level intentionally keeps prompt and source-code payloads intact,
// but auth/header/key-looking fields are still replaced in every trace level.
function redactValue(value, options = {}) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return options.full ? value : safety.scrubSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, options));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED:key]';
    } else {
      out[key] = redactValue(item, options);
    }
  }
  return out;
}

function messageSummary(messages) {
  const summary = { count: 0, roles: {}, content_blocks: {}, bytes: 0 };
  if (!Array.isArray(messages)) return summary;
  summary.count = messages.length;
  summary.bytes = bytes(messages);
  for (const message of messages) {
    summary.roles[message.role || 'unknown'] = (summary.roles[message.role || 'unknown'] || 0) + 1;
    const content = Array.isArray(message.content) ? message.content : [{ type: typeof message.content }];
    for (const block of content) {
      const type = block && block.type ? block.type : 'text';
      summary.content_blocks[type] = (summary.content_blocks[type] || 0) + 1;
    }
  }
  return summary;
}

function bodySummary(body) {
  if (!body || typeof body !== 'object') return { bytes: bytes(body) };
  const systemBlocks = Array.isArray(body.system) ? body.system.length : body.system ? 1 : 0;
  return {
    model: body.model || null,
    stream: !!body.stream,
    max_tokens: body.max_tokens || null,
    bytes: bytes(body),
    body_sha256: sha256(JSON.stringify(body)),
    system_blocks: systemBlocks,
    system_bytes: bytes(body.system || ''),
    messages: messageSummary(body.messages),
    tools_count: Array.isArray(body.tools) ? body.tools.length : 0,
    tool_names: Array.isArray(body.tools) ? body.tools.map((tool) => tool.name).filter(Boolean) : [],
  };
}

function headerSummary(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  return { count: names.length, names: [...new Set(names)].sort() };
}

function captureForLevel(level, value) {
  if (level === 'summary' || level === 'off') return undefined;
  return redactValue(value, { full: level === 'full' });
}

class JsonlTrace {
  constructor({ filePath, level, traceId, layer }) {
    this.filePath = filePath;
    this.level = normalizeTraceLevel(level);
    this.traceId = makeTraceId(traceId);
    this.layer = layer;
    if (this.level !== 'off') fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  append(type, fields = {}) {
    if (this.level === 'off') return;
    const event = redactValue({
      ts: new Date().toISOString(),
      type,
      layer: this.layer,
      trace_id: this.traceId,
      capture_level: this.level,
      ...fields,
    });
    fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n');
  }

  capture(value) {
    return captureForLevel(this.level, value);
  }

  preview(bufferOrText) {
    if (this.level === 'summary' || this.level === 'off') return undefined;
    const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString('utf8') : String(bufferOrText || '');
    return redactValue(text.slice(0, PREVIEW_BYTES), { full: this.level === 'full' });
  }
}

module.exports = {
  JsonlTrace,
  PREVIEW_BYTES,
  TRACE_LEVELS,
  bodySummary,
  bytes,
  captureForLevel,
  defaultBridgeTracePath,
  defaultRunnerTracePath,
  headerSummary,
  makeTraceId,
  messageSummary,
  normalizeTraceLevel,
  redactValue,
  sha256,
};
