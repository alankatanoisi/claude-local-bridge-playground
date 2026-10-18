'use strict';

/**
 * bridge-hosts-table.test.js — the ONE host table (2026-10-17).
 *
 * Before this date the Finder controller (control.js) and the ACP adapter
 * (connection-operations.js) each carried their own ports, launchd label,
 * output parsers, readiness probe, and controller lock, and the copies had
 * begun to disagree. These tests pin that everything is now derived from
 * src/hosting/hosts.js, that the policy module never reaches for the
 * controller, and that the shared primitives behave the same for both callers.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const hosts = require('../src/hosting/hosts');
const control = require('../src/hosting/control');
const { validateVscodeUrl, createHostManager } = require('../src/hosting/ensure');
const { DEFAULT_BRIDGE_URL } = require('../src/runner/model-client');

async function freeLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('one host table: the controller, the composer order, and the VS Code default all derive from it', () => {
  assert.equal(control.MODES, hosts.MODES, 'control.js must re-export the derived table, not its own literal');
  assert.deepEqual(hosts.MODES, { standalone: 11467, desktop: 11447, browser: 11457 });
  // Composer order: standalone first because it is the new-chat default.
  assert.deepEqual(Object.keys(hosts.HOSTS), ['standalone', 'desktop', 'browser', 'vscode']);
  for (const [mode, port] of Object.entries(hosts.MODES)) {
    assert.equal(hosts.HOSTS[mode].managed, true);
    assert.equal(hosts.HOSTS[mode].port, port);
  }
  assert.equal(hosts.HOSTS.vscode.managed, false);
  assert.equal(String(hosts.HOSTS.vscode.port), new URL(DEFAULT_BRIDGE_URL).port);
  assert.equal(validateVscodeUrl(), DEFAULT_BRIDGE_URL);
  for (const host of Object.values(hosts.HOSTS)) {
    assert.ok(host.name && host.description && host.timeout > 0, 'every host carries name, blurb, and deadline');
  }
  assert.equal(control.WEB_PORT, hosts.WEB_PORT);
  assert.equal(hosts.BROWSER_EDITOR_URL, 'http://127.0.0.1:' + hosts.WEB_PORT + '/');
  assert.equal(hosts.messagesUrl(hosts.MODES.standalone), 'http://127.0.0.1:11467/v1/messages');
});

test('ensure.js never loads control.js, and the host manager refuses to run without injected operations', () => {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      'require(' +
        JSON.stringify(path.resolve('src/hosting/ensure.js')) +
        '); process.stdout.write(JSON.stringify(Object.keys(require.cache)))',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const loaded = JSON.parse(probe.stdout);
  assert.ok(!loaded.some((file) => file.endsWith(path.join('hosting', 'control.js'))), 'ensure.js loaded control.js');
  assert.ok(
    !loaded.some((file) => file.endsWith(path.join('hosting', 'connection-operations.js'))),
    'ensure.js loaded the macOS adapter',
  );
  assert.throws(() => createHostManager(), /requires host operations/);
  assert.equal(control.ensure, undefined, 'the controller no longer reaches down into ensure.js');
  assert.equal(
    control.connectionOperations,
    undefined,
    'the adapter is built by the ACP entry point, not the controller',
  );
});

test('the three macOS tools are read by one set of parsers', () => {
  assert.deepEqual(hosts.jobStateFromPrint('{\n\tpid = 123\n}\n'), { loaded: true, pid: 123 });
  assert.deepEqual(hosts.jobStateFromPrint('{\n\tstate = waiting\n}\n'), { loaded: true, pid: null });
  assert.deepEqual(hosts.jobStateFromExitCode(113), { loaded: false, pid: null });
  assert.deepEqual(hosts.jobStateFromExitCode(3), { loaded: false, pid: null });
  assert.equal(hosts.jobStateFromExitCode(42), null, 'an unknown failure is not "stopped"');
  assert.equal(hosts.jobStateFromExitCode(undefined), null);
  assert.deepEqual(hosts.listenerPidsFrom('p456\nf12\np789\n'), [456, 789]);
  assert.deepEqual(hosts.listenerPidsFrom(''), []);
  const rows = hosts.processRowsFrom(' 123 1\n456 123\n789 1\n901 456\n');
  assert.deepEqual([...hosts.descendantPids(rows, 123)].sort(), [123, 456, 901]);
  assert.equal(hosts.ownsAllListeners([456, 901], 123, rows), true);
  assert.equal(hosts.ownsAllListeners([456, 789], 123, rows), false, 'one foreign listener means not owned');
  assert.equal(hosts.ownsAllListeners([], 123, rows), false, 'no listener means not owned');
  assert.equal(hosts.ownsAllListeners([456], null, rows), false);
  assert.equal(hosts.launchdLabel('desktop'), 'org.alan.claude-bridge-lab.desktop');
  assert.match(hosts.launchdTarget('browser'), /^gui\/\d+\/org\.alan\.claude-bridge-lab\.browser$/);
});

test('one lock body serves both modes: fail at once for the controller, wait for a chat', async () => {
  const port = await freeLoopbackPort();
  const order = [];
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const reached = new Promise((resolve) => {
    entered = resolve;
  });
  const holder = hosts.withLoopbackLock(
    async () => {
      order.push('held');
      entered();
      await held;
      order.push('released');
    },
    { port },
  );
  await reached;
  await assert.rejects(
    control.withLock(async () => order.push('never'), port),
    /active/,
  );
  const waiter = hosts.withLoopbackLock(async () => order.push('waited'), {
    port,
    wait: true,
    signal: AbortSignal.timeout(2000),
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  release();
  await Promise.all([holder, waiter]);
  assert.deepEqual(order, ['held', 'released', 'waited']);
});

test('the readiness probe accepts only a 204 preflight and reports an abort as an abort', async (t) => {
  let status = 204;
  const server = http.createServer((req, res) => {
    res.statusCode = req.method === 'OPTIONS' ? status : 500;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = 'http://127.0.0.1:' + server.address().port + '/v1/messages';
  assert.equal(await hosts.probeMessagesEndpoint(url), true);
  status = 200;
  assert.equal(await hosts.probeMessagesEndpoint(url), false);
  const dead = await freeLoopbackPort();
  assert.equal(await hosts.probeMessagesEndpoint('http://127.0.0.1:' + dead + '/v1/messages'), false);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(hosts.probeMessagesEndpoint(url, { signal: abort.signal }), { name: 'AbortError' });
});
