'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateStarlark, extractStarlark } = require('../src/starlark');

test('extracts fenced Starlark without surrounding prose', () => {
  assert.equal(extractStarlark('Here:\n```starlark\ndef plan(ctx):\n    return []\n```'), 'def plan(ctx):\n    return []');
});

test('evaluates pure JSON-shaped Starlark', async () => {
  const response = await evaluateStarlark({
    source: 'def plan(ctx):\n    return [{"id": ctx["id"], "items": [1, 2]}]',
    functionName: 'plan',
    context: { id: 'job' },
    maxSteps: 10000,
    timeoutMs: 1000,
  });
  assert.deepEqual(response.result, [{ id: 'job', items: [1, 2] }]);
  assert.ok(response.steps > 0);
});

test('rejects module loads', async () => {
  await assert.rejects(
    evaluateStarlark({
      source: 'load("outside.star", "x")\ndef plan(ctx):\n    return []',
      functionName: 'plan',
      context: {},
      maxSteps: 10000,
      timeoutMs: 1000,
    }),
    /load is disabled/,
  );
});

test('stops a generated program at the execution-step ceiling', async () => {
  await assert.rejects(
    evaluateStarlark({
      source: 'def plan(ctx):\n    values = []\n    for i in range(100000000):\n        values.append(i)\n    return values',
      functionName: 'plan',
      context: {},
      maxSteps: 1000,
      timeoutMs: 1000,
    }),
    /too many steps|cancel/i,
  );
});
