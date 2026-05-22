'use strict';

const vscode = require('vscode');
const {
  JsonlTrace,
  bodySummary,
  defaultBridgeTracePath,
  headerSummary,
  makeTraceId,
  normalizeTraceLevel,
} = require('./trace-utils');

function headerValue(req, name) {
  const value = req.headers[name] || req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function createBridgeTrace(req) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const requested = normalizeTraceLevel(headerValue(req, 'x-local-bridge-trace-level'));
  const configured = normalizeTraceLevel(config.get('traceLevel', 'off'));
  const level = requested !== 'off' ? requested : configured;
  if (level === 'off') return null;

  const traceId = makeTraceId(headerValue(req, 'x-local-bridge-trace-id'));
  const trace = new JsonlTrace({
    filePath: defaultBridgeTracePath(traceId),
    level,
    traceId,
    layer: 'bridge',
  });
  trace.turn = headerValue(req, 'x-local-bridge-trace-turn') || null;
  trace.runId = headerValue(req, 'x-local-bridge-run-id') || null;
  return trace;
}

function appendIncoming(trace, req, body) {
  if (!trace) return;
  trace.append('bridge_request_received', {
    run_id: trace.runId,
    turn: trace.turn,
    boundary: 'runner_to_bridge',
    method: req.method,
    url: req.url,
    headers: headerSummary(req.headers),
    body: bodySummary(body),
    payload: trace.capture(body),
  });
}

function appendTransformed(trace, body, fields = {}) {
  if (!trace) return;
  trace.append('bridge_request_transformed', {
    run_id: trace.runId,
    turn: trace.turn,
    boundary: 'bridge_to_upstream',
    body: bodySummary(body),
    payload: trace.capture(body),
    ...fields,
  });
}

module.exports = { appendIncoming, appendTransformed, createBridgeTrace };
