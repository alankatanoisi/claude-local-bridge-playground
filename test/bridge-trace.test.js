'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vscode = require('./__mocks__/vscode');
const { appendIncoming, appendTransformed, createBridgeTrace } = require('../src/bridge-trace');

test('createBridgeTrace returns null when trace level is off', () => {
  vscode.__setConfig('traceLevel', 'off');
  const trace = createBridgeTrace({ headers: {} });
  vscode.__resetConfig();
  assert.equal(trace, null);
});

test('createBridgeTrace honors request headers over configuration', () => {
  vscode.__setConfig('traceLevel', 'off');
  const trace = createBridgeTrace({
    headers: {
      'x-local-bridge-trace-level': 'summary',
      'x-local-bridge-trace-id': 'trace_test_123',
      'x-local-bridge-run-id': 'run-1',
      'x-local-bridge-trace-turn': 'turn-9',
    },
  });
  vscode.__resetConfig();

  assert.ok(trace);
  assert.equal(trace.level, 'summary');
  assert.equal(trace.traceId, 'trace_test_123');
  assert.equal(trace.runId, 'run-1');
  assert.equal(trace.turn, 'turn-9');
});

test('appendIncoming and appendTransformed capture boundaries and summaries', () => {
  const events = [];
  const trace = {
    runId: 'run-2',
    turn: 'turn-2',
    append: (type, fields) => events.push({ type, fields }),
    capture: (value) => value,
  };
  const req = {
    method: 'POST',
    url: '/v1/messages',
    headers: { 'x-test': '1' },
  };
  const body = { model: 'claude-test', messages: [{ role: 'user', content: 'hi' }] };

  appendIncoming(trace, req, body);
  appendTransformed(trace, body, { upstream: 'anthropic' });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'bridge_request_received');
  assert.equal(events[0].fields.boundary, 'runner_to_bridge');
  assert.equal(events[0].fields.headers.count, 1);
  assert.equal(events[0].fields.body.model, 'claude-test');
  assert.equal(events[1].type, 'bridge_request_transformed');
  assert.equal(events[1].fields.boundary, 'bridge_to_upstream');
  assert.equal(events[1].fields.upstream, 'anthropic');
});
