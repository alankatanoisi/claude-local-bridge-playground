'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { evaluatorRequired } = require('./helpers/evaluator-required');

const { evaluateStarlark, extractStarlark } = require('../src/starlark');

test('extracts fenced Starlark without surrounding prose', () => {
  assert.equal(
    extractStarlark('Here:\n```starlark\ndef plan(ctx):\n    return []\n```'),
    'def plan(ctx):\n    return []',
  );
});

test('evaluates pure JSON-shaped Starlark', evaluatorRequired, async () => {
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

test('rejects module loads', evaluatorRequired, async () => {
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

test('stops a generated program at the execution-step ceiling', evaluatorRequired, async () => {
  await assert.rejects(
    evaluateStarlark({
      source:
        'def plan(ctx):\n    values = []\n    for i in range(100000000):\n        values.append(i)\n    return values',
      functionName: 'plan',
      context: {},
      maxSteps: 1000,
      timeoutMs: 1000,
    }),
    /too many steps|cancel/i,
  );
});

// Low #8 regression: use a tiny stand-in executable that deliberately stays
// alive. Aborting the run must reject the evaluator call and terminate that
// exact child, without waiting for the evaluator's 30-second timeout.
test('run abort signal terminates the evaluator child', { timeout: 3000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-abort-child-'));
  const binary = path.join(dir, 'blocking-evaluator');
  const pidFile = path.join(dir, 'child.pid');
  let childPid = null;

  fs.writeFileSync(
    binary,
    [
      // Use the exact Node executable running this test. This avoids making
      // the fixture depend on how (or whether) `node` appears in PATH.
      `#!${process.execPath}`,
      "'use strict';",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      'process.stdin.resume();',
      'setInterval(() => {}, 1000);',
    ].join('\n'),
    { mode: 0o700 },
  );
  t.after(() => {
    // Clean up only the exact temporary child started by this test.
    if (childPid !== null) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const controller = new AbortController();
  const evaluation = evaluateStarlark({
    source: 'def plan(ctx):\n    return []',
    functionName: 'plan',
    context: {},
    maxSteps: 10000,
    timeoutMs: 30000,
    binary,
    signal: controller.signal,
  });

  // Wait until the child proves it is running before sending the abort.
  for (let attempt = 0; attempt < 200 && !fs.existsSync(pidFile); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!fs.existsSync(pidFile)) {
    // Settle the outstanding promise before failing, so a broken fixture can
    // never leak an unhandled rejection into a later test.
    controller.abort(new Error('test fixture did not start'));
    await evaluation.catch(() => {});
    assert.fail('evaluator child did not start');
  }
  childPid = Number(fs.readFileSync(pidFile, 'utf8'));
  controller.abort(new Error('test run abort'));

  await assert.rejects(evaluation, (error) => error.name === 'AbortError' || /abort/i.test(error.message));

  // The promise may reject on the AbortError just before the operating system
  // finishes reaping the child, so poll briefly for the observable exit.
  let childStillExists = true;
  for (let attempt = 0; attempt < 100 && childStillExists; attempt += 1) {
    try {
      process.kill(childPid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      childStillExists = false;
    }
  }
  assert.equal(childStillExists, false, 'aborted evaluator child exited');
  childPid = null;
});
