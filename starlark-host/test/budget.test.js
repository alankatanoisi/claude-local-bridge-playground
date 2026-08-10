'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { CostBudget, postMessage } = require('../src/bridge');

test('concurrent reservations cannot overbook the experiment cap', () => {
  const budget = new CostBudget(1);
  const first = budget.reserve(0.6, 'first');
  assert.throws(() => budget.reserve(0.6, 'second'), /cost gate blocked/);
  budget.release(first);
  assert.doesNotThrow(() => budget.reserve(0.6, 'second-after-release'));
});

test('settlement replaces a reservation with actual estimated cost', () => {
  const budget = new CostBudget(1);
  const reservation = budget.reserve(0.8, 'call');
  budget.settle(reservation, { label: 'call', costUsd: 0.25 });
  assert.equal(budget.reservedUsd, 0);
  assert.equal(budget.usedUsd, 0.25);
});

test('balanced concurrent reservations do not leave floating-point residue', () => {
  const budget = new CostBudget(1);
  const first = budget.reserve(0.1, 'first');
  const second = budget.reserve(0.2, 'second');
  budget.release(first);
  budget.release(second);
  assert.equal(budget.reservedUsd, 0);
});

test('direct bridge requests use the conventional full-trace correlation headers', async () => {
  const originalFetch = global.fetch;
  let capturedHeaders;
  global.fetch = async (_url, options) => {
    capturedHeaders = options.headers;
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  try {
    await postMessage('http://127.0.0.1:11437/v1/messages', { model: 'fixture' }, null, {
      level: 'full',
      traceId: 'prototype-12345678',
      runId: 'prototype-12345678',
      turn: 7,
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(capturedHeaders['x-local-bridge-trace-level'], 'full');
  assert.equal(capturedHeaders['x-local-bridge-trace-id'], 'prototype-12345678');
  assert.equal(capturedHeaders['x-local-bridge-run-id'], 'prototype-12345678');
  assert.equal(capturedHeaders['x-local-bridge-trace-turn'], '7');
});
