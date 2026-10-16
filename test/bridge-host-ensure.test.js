'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHostManager, validateVscodeUrl } = require('../src/hosting/ensure');

// The fake represents services, not implementation details: starting one host
// must never change another host's state. No real launchd jobs run in tests.
function fixture() {
  const states = Object.fromEntries(['standalone', 'desktop', 'browser'].map((host) => [host, {}]));
  const starts = [];
  const opens = [];
  let installed = true;
  let tail = Promise.resolve();
  const operations = {
    inspect: async (host) => ({ ...states[host] }),
    installed: async () => installed,
    locked: async (action) => {
      const before = tail;
      let done;
      tail = new Promise((resolve) => {
        done = resolve;
      });
      await before;
      try {
        return await action();
      } finally {
        done();
      }
    },
    start: async (host) => {
      starts.push(host);
      states[host] = { pid: 42, loaded: true, occupied: true, owned: true, ready: true };
    },
    openBrowser: async () => {
      opens.push('browser');
    },
    probe: async () => false,
    pause: async (signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  };
  return {
    states,
    starts,
    opens,
    operations,
    setInstalled: (value) => {
      installed = value;
    },
  };
}

test('starts only the selected host, reuses it, and serializes concurrent requests', async () => {
  const f = fixture();
  f.states.desktop = { pid: 7, loaded: true, occupied: true, owned: true, ready: true };
  const manager = createHostManager(f.operations);
  const results = await Promise.all([manager.ensure('standalone'), manager.ensure('standalone')]);
  assert.deepEqual(f.starts, ['standalone']);
  assert.equal(f.states.desktop.pid, 7);
  assert.equal(results[0].bridgeUrl, 'http://127.0.0.1:11467/v1/messages');
  assert.equal(results[1].bridgeUrl, results[0].bridgeUrl);
});

test('existing VS Code is connect-only and an override never affects managed addresses', async () => {
  const f = fixture();
  const seen = [];
  f.operations.probe = async (url) => {
    seen.push(url);
    return true;
  };
  const manager = createHostManager(f.operations, { vscodeUrl: 'http://localhost:11537' });
  assert.equal((await manager.ensure('vscode')).bridgeUrl, 'http://localhost:11537/v1/messages');
  assert.equal((await manager.ensure('desktop')).bridgeUrl, 'http://127.0.0.1:11447/v1/messages');
  assert.deepEqual(f.starts, ['desktop']);
  assert.deepEqual(seen, ['http://localhost:11537/v1/messages']);
  assert.deepEqual(f.opens, []);
});

test('a loaded desktop job with no process is started rather than treated as running', async () => {
  const f = fixture();
  f.states.desktop = { loaded: true, pid: null };
  await createHostManager(f.operations).ensure('desktop');
  assert.deepEqual(f.starts, ['desktop']);
});

test('rejects remote, credential-bearing and non-Messages VS Code overrides without echoing them', () => {
  for (const url of [
    'https://example.com',
    'http://user:private@localhost:11437',
    'http://127.0.0.1/a',
    'http://localhost:11437/?token=private',
    'file:///private',
  ]) {
    assert.throws(
      () => validateVscodeUrl(url),
      (error) => !error.message.includes('private'),
    );
  }
});

test('unavailable VS Code reports the exact next action without starting services', async () => {
  const f = fixture();
  await assert.rejects(
    createHostManager(f.operations).ensure('vscode'),
    /existing VS Code bridge is unavailable at port 11437/,
  );
  assert.deepEqual(f.starts, []);
});

test('occupied ports and missing installations fail before launching', async () => {
  const f = fixture();
  f.states.standalone = { occupied: true, owned: false };
  await assert.rejects(createHostManager(f.operations).ensure('standalone'), /another process/);
  f.states.standalone = {};
  f.setInstalled(false);
  await assert.rejects(createHostManager(f.operations).ensure('standalone'), /Install/);
  assert.deepEqual(f.starts, []);
});

test('a running unhealthy host times out without restart or fallback', async () => {
  const f = fixture();
  f.states.standalone = { pid: 9, loaded: true };
  await assert.rejects(
    createHostManager(f.operations, { timeouts: { standalone: 15 } }).ensure('standalone'),
    /not ready/,
  );
  assert.deepEqual(f.starts, []);
});

test('browser activation opens the editor, reports waiting, and does not imply a model call', async () => {
  const f = fixture();
  f.states.browser = { pid: 9, loaded: true, editorReady: true };
  f.operations.openBrowser = async () => {
    f.opens.push('browser');
    f.states.browser = { pid: 9, loaded: true, occupied: true, owned: true, ready: true };
  };
  const progress = [];
  await createHostManager(f.operations).ensure('browser', { onStatus: (value) => progress.push(value) });
  assert.deepEqual(f.opens, ['browser']);
  assert.ok(progress.some((value) => value.includes('editor activation')));
  assert.deepEqual(f.starts, []);
});

test('cancel during readiness stops waiting and never stops a shared host', async () => {
  const f = fixture();
  f.states.desktop = { pid: 9, loaded: true };
  const abort = new AbortController();
  const waiting = createHostManager(f.operations).ensure('desktop', { signal: abort.signal });
  abort.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(f.states.desktop.pid, 9);
  assert.deepEqual(f.starts, []);
});
