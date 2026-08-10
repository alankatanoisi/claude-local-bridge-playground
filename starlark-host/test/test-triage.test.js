'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildSafeTestEnvironment,
  collectTestFailureDocuments,
  parseTapFailures,
  validateSuite,
} = require('../src/test-triage');

const ROOT = path.resolve(__dirname, '..');

test('TAP failures become bounded virtual documents', async () => {
  const collected = await collectTestFailureDocuments({
    suiteName: 'fixture',
    baseRoot: ROOT,
    suites: {
      fixture: {
        cwd: '.',
        command: ['node', '--test', 'fixtures/failing-suite.test.js'],
        timeoutMs: 10000,
      },
    },
  });

  assert.equal(collected.execution.exitCode, 1);
  assert.equal(collected.execution.timedOut, false);
  assert.equal(collected.documents.length, 2);
  assert.ok(collected.documents.every((document) => document.kind === 'test_failure'));
  assert.match(collected.documents[0].text, /fixture/);
});

test('test execution rejects non-allowlisted executables', () => {
  assert.throws(
    () => validateSuite('unsafe', { command: ['bash', '-c', 'echo unsafe'] }),
    /not allowlisted/,
  );
});

test('TAP parser deduplicates repeated failure names', () => {
  const failures = parseTapFailures('not ok 1 - duplicate\n  error: first\nnot ok 2 - duplicate\n  error: second\n1..2\n');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].message, 'first');
});

test('test subprocess environment removes likely credentials', () => {
  const env = buildSafeTestEnvironment({
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    BRIDGE_CALLER_TOKEN: 'secret',
    GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json',
    GIT_AUTHOR_NAME: 'Local User',
    ORDINARY_SETTING: 'kept',
  });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.ORDINARY_SETTING, 'kept');
  assert.equal(env.GIT_AUTHOR_NAME, 'Local User');
  assert.equal(env.BRIDGE_CALLER_TOKEN, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});
