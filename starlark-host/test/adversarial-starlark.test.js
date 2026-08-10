'use strict';

/**
 * R7: hostile-program corpus for the Starlark evaluator boundary.
 *
 * The live campaigns exercised honest-but-fallible planners. This suite sends
 * deliberately hostile programs and asserts the boundary FAILS CLOSED at one
 * of its layers: the Go evaluator (steps, timeout, no load, no recursion),
 * the Node harness (stdout ceiling), or the descriptor validator (unknown
 * fields, counts, shapes). This is the permission-safari discipline applied
 * to the code-as-plan surface.
 *
 * These tests need the compiled evaluator (npm run build:evaluator). They
 * skip with an explicit message if it is missing rather than passing green.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { DEFAULT_BINARY, evaluateStarlark } = require('../src/starlark');
const { validateJobs } = require('../src/validator');

const binaryPresent = fs.existsSync(DEFAULT_BINARY);
const run = (options) =>
  evaluateStarlark({ functionName: 'plan', context: {}, maxSteps: 200000, timeoutMs: 2000, ...options });

function policyFixture() {
  return {
    maxJobsPerPhase: 4,
    inputIds: ['doc1'],
    workerNames: ['code_analyst'],
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    defaultMaxOutputTokens: 900,
    maxOutputTokens: 2600,
    maxTaskCharacters: 1200,
    failedJobIds: [],
    oneInputPerJob: true,
    requireAllInputs: false,
    allowDependencies: false,
  };
}

test('comprehension bomb trips the deterministic step ceiling', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  // Note: starlark-go rejects the '**' operator outright, so the bomb uses a
  // literal count. The comprehension burns one step per element and must hit
  // the 200k step ceiling long before completing a billion iterations.
  await assert.rejects(
    run({ source: 'def plan(ctx):\n    return [x for x in range(1000000000)]' }),
    /step|exceeded|too many/i,
  );
});

test('while loop is rejected at parse/resolve time', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  await assert.rejects(
    run({ source: 'def plan(ctx):\n    while True:\n        pass\n    return []' }),
    /while|not supported|parse|syntax/i,
  );
});

test('recursion is rejected by the evaluator', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  await assert.rejects(
    run({ source: 'def plan(ctx):\n    return plan(ctx)' }),
    /recursion|recursive/i,
  );
});

test('load() is disabled', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  await assert.rejects(
    run({ source: 'load("evil.star", "x")\ndef plan(ctx):\n    return []' }),
    /load is disabled|load/i,
  );
});

test('homoglyph function names do not satisfy the required entry point', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  // Cyrillic 'р' in 'рlan' — visually identical, semantically absent.
  await assert.rejects(
    run({ source: 'def рlan(ctx):\n    return []' }),
    /was not defined/,
  );
});

test('giant string output is stopped by the host stdout ceiling', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  // ~48MB result in very few steps: the step ceiling cannot catch this;
  // the Node-side output cap must.
  await assert.rejects(
    run({
      source: 'def plan(ctx):\n    return "a" * (48 * 1000 * 1000)',
      timeoutMs: 10000,
    }),
    /output exceeded/,
  );
});

test('deeply nested results fail closed at the validator, not with a crash', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  const source = [
    'def plan(ctx):',
    '    value = []',
    '    for _ in range(2000):',
    '        value = [value]',
    '    return value',
  ].join('\n');
  const evaluated = await run({ source });
  // The evaluator survives and returns a well-formed (if absurd) value…
  assert.ok(Array.isArray(evaluated.result));
  // …and the validator rejects it because its elements are not job objects.
  assert.throws(() => validateJobs(evaluated.result, policyFixture()), /must be an object/);
});

test('oversized job counts are rejected by the phase limit', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  const source = [
    'def plan(ctx):',
    '    return [{',
    '        "id": "job_" + str(i),',
    '        "worker": "code_analyst",',
    '        "task": "Analyze the assigned fixture document.",',
    '        "input_ids": ["doc1"],',
    '        "depends_on": [],',
    '        "timeout_ms": 30000,',
    '        "max_output_tokens": 900,',
    '    } for i in range(500)]',
  ].join('\n');
  const evaluated = await run({ source });
  assert.throws(() => validateJobs(evaluated.result, policyFixture()), /exceeds phase limit/);
});

test('descriptor smuggling: authority-shaped and alias fields are rejected', () => {
  const base = {
    id: 'job_a',
    worker: 'code_analyst',
    task: 'Analyze the assigned fixture document.',
    input_ids: ['doc1'],
    depends_on: [],
    timeout_ms: 30000,
    max_output_tokens: 900,
  };
  const policy = policyFixture();
  for (const smuggled of ['model', 'provider', 'shell', 'command', 'path', 'url', 'Timeout_ms', 'worker ']) {
    assert.throws(
      () => validateJobs([{ ...base, [smuggled]: 'x' }], policy),
      /unknown field/,
      `'${smuggled}' must be rejected`,
    );
  }
});

test('infinite-loop-shaped compute is stopped by the wall-clock timeout as second guard', { skip: !binaryPresent && 'evaluator binary not built' }, async () => {
  // Big-but-under-step-ceiling compute with a tiny timeout: the cancel timer
  // must win even when the step ceiling would not trip.
  await assert.rejects(
    run({
      source: 'def plan(ctx):\n    return [x * x for x in range(190000)]',
      maxSteps: 10_000_000,
      timeoutMs: 1,
    }),
    /timed out|cancel/i,
  );
});
