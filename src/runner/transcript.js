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

const path = require('path');
const safety = require('./safety');
const { ensurePrivateDir, privateAppendFileSync } = require('./private-fs');

const SENSITIVE_KEYS = ['authorization', 'x-api-key', 'cookie', 'set-cookie'];
const STABLE_IDENTIFIER_HEADER_PATTERN =
  /^[a-z0-9_.-]*(?:device|machine|organization|org|account|session)[_-]?(?:id|uuid)$/i;

function isStableIdentifierHeader(name) {
  const lower = String(name || '').toLowerCase();
  // The runner's own trace headers are local breadcrumbs that let a human match
  // transcript lines to trace files. They are not upstream account telemetry,
  // so we keep them to preserve debugging value.
  if (lower.startsWith('x-local-bridge-')) return false;
  return STABLE_IDENTIFIER_HEADER_PATTERN.test(lower);
}

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.includes(lower) && typeof v === 'string') {
      out[k] = v.length > 16 ? v.slice(0, 8) + '…REDACTED…' + v.slice(-4) : '…REDACTED…';
    } else if (isStableIdentifierHeader(lower) && typeof v === 'string') {
      out[k] = '[REDACTED:stable_identifier]';
    } else {
      out[k] = typeof v === 'string' ? safety.scrubSecrets(v) : v;
    }
  }
  return out;
}

function redactEvent(event) {
  const copy = safety.scrubObject(event);
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
    this._buf = [];
    ensurePrivateDir(path.dirname(filePath));
  }

  append(event) {
    const safe = redactEvent(event);
    this._buf.push(JSON.stringify(safe));
    if (this._buf.length >= 10) this.flush();
  }

  flush() {
    if (this._buf.length === 0) return;
    const lines = this._buf.join('\n') + '\n';
    privateAppendFileSync(this.filePath, lines);
    this._buf = [];
  }

  writeFinal(text) {
    this.append({ type: 'final', text });
    this.flush();
  }

  // Record the end-of-run usage/cost summary. Stores raw counts and derived
  // fields so scripts get exact token numbers without parsing a display string.
  // Flushes immediately because this is written after the final event.
  recordUsage(summary) {
    if (!summary) return;
    this.append({ type: 'usage', ...summary });
    this.flush();
  }
}

module.exports = { Transcript, redactEvent, redactHeaders };
