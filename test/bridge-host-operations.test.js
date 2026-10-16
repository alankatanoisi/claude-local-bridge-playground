'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { connectionOperations } = require('../src/hosting/connection-operations');

async function listener(t) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    if (server.listening) server.close();
  });
  return server;
}

function setup(t, lockPort, executeCommand) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-operations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = {
    root,
    modes: { standalone: 11467, desktop: 11447, browser: 11457 },
    webPort: 18080,
    lockPort,
    executeCommand,
  };
  return { root, operations: connectionOperations(options), options };
}

test('a busy real controller lock can be cancelled without running the action', async (t) => {
  const blocker = await listener(t);
  const { operations } = setup(t, blocker.address().port);
  const cancel = new AbortController();
  let ran = false;
  const waiting = operations.locked(() => {
    ran = true;
  }, cancel.signal);
  setTimeout(() => cancel.abort(), 20);
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(ran, false);
  assert.equal(blocker.listening, true);
});

test('independent adapters serialize on the same operating-system lock', async (t) => {
  const server = await listener(t);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const { operations, options } = setup(t, port);
  const other = connectionOperations(options);
  const signal = AbortSignal.timeout(2000);
  let release;
  let entered;
  const acquired = new Promise((resolve) => {
    entered = resolve;
  });
  const order = [];
  const first = operations.locked(async () => {
    order.push('first');
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    order.push('released');
  }, signal);
  await acquired;
  const second = other.locked(() => order.push('second'), signal);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'released', 'second']);
});

test('browser activation is deduplicated across adapters and never passes a password to open', async (t) => {
  const server = await listener(t);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const calls = [];
  const executeCommand = async (program, args) => {
    calls.push({ program, args });
    return { stdout: program === '/bin/launchctl' ? '\n pid = 123\n' : '' };
  };
  const { root, operations, options } = setup(t, port, executeCommand);
  await Promise.all([
    operations.openBrowser(123, AbortSignal.timeout(2000)),
    connectionOperations(options).openBrowser(123, AbortSignal.timeout(2000)),
  ]);
  const opens = calls.filter((call) => call.program === '/usr/bin/open');
  assert.deepEqual(
    opens.map((call) => call.args),
    [['http://127.0.0.1:18080/']],
  );
  assert.equal(fs.statSync(path.join(root, 'browser-open-attempt.json')).mode & 0o777, 0o600);
  assert.deepEqual(
    Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'browser-open-attempt.json'), 'utf8'))).sort(),
    ['openedAt', 'pid'],
  );
});

test(
  'loaded stopped jobs use kickstart without a kill flag; unloaded jobs use bootstrap',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const calls = [];
    const { operations } = setup(t, 0, async (program, args) => {
      calls.push({ program, args });
      return { stdout: '' };
    });
    await operations.start('desktop', AbortSignal.timeout(2000), { loaded: true });
    await operations.start('standalone', AbortSignal.timeout(2000), { loaded: false });
    const control = calls.filter((call) => call.program === '/bin/launchctl');
    assert.equal(control[0].args[0], 'kickstart');
    assert.equal(control[1].args[0], 'bootstrap');
    assert.ok(!JSON.stringify(calls).includes('"-k"'));
    assert.ok(!JSON.stringify(calls).includes('bootout'));
  },
);

test('an unrelated listener is never adopted as a managed host', async (t) => {
  const { operations } = setup(t, 0, async (program) => ({
    stdout:
      program === '/bin/launchctl'
        ? '\n pid = 123\n'
        : program === '/bin/ps'
          ? '123 1\n456 123\n789 1\n'
          : 'p456\np789\n',
  }));
  const state = await operations.inspect('standalone', AbortSignal.timeout(2000));
  assert.equal(state.occupied, true);
  assert.equal(state.owned, false);
  assert.equal(state.ready, false);
});

test('subprocess failures expose a fixed message instead of captured private output', async (t) => {
  const { operations } = setup(t, 0, async () => {
    throw Object.assign(new Error('private-output-marker'), { stderr: 'private-output-marker', code: 42 });
  });
  await assert.rejects(
    operations.inspect('standalone', AbortSignal.timeout(2000)),
    (error) => error.message === 'Could not inspect the selected managed bridge job. No service was changed.',
  );
});
