'use strict';

/**
 * transcript.js — Append-only JSONL log of the agent run.
 *
 * Redacts sensitive-looking values before writing.
 *
 * Event types:
 *   user_prompt, request, assistant, tool_call, tool_result, tool_confirm,
 *   tool_denied, final, error
 */

const fs = require('fs');
const path = require('path');

const SENSITIVE_KEYS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.includes(lower) && typeof v === 'string') {
      out[k] = v.length > 16 ? v.slice(0, 8) + '…REDACTED…' + v.slice(-4) : '…REDACTED…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function redactEvent(event) {
  const copy = { ...event };
  if (copy.headers) {
    copy.headers = redactHeaders(copy.headers);
  }
  if (copy.request && copy.request.headers) {
    copy.request.headers = redactHeaders(copy.request.headers);
  }
  return copy;
}

class Transcript {
  constructor(filePath) {
    this.filePath = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  append(event) {
    const safe = redactEvent(event);
    const line = JSON.stringify(safe) + '\n';
    fs.appendFileSync(this.filePath, line);
  }

  writeFinal(text) {
    this.append({ type: 'final', text });
  }
}

module.exports = { Transcript, redactHeaders };
