'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const { createAcpAgent } = require('../../src/runner/acp/agent');
const { createConnection } = require('../../src/runner/acp/connection');
const { settingsPath, readHost, saveHost } = require('../../src/runner/acp/host-settings');
const { STOP_REASONS } = require('../../src/runner/kernel/contract');

function client(t, options = {}) {
  const directory = options.directory || fs.mkdtempSync(path.join(os.tmpdir(), 'acp-hosts-'));
  if (!options.directory) t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const incoming = new PassThrough();
  const outgoing = new PassThrough();
  const updates = [];
  const calls = [];
  const hosts = [];
  const hostManager = options.hostManager || {
    ensure: async (host) => {
      hosts.push(host);
      return { bridgeUrl: 'http://127.0.0.1/' + host };
    },
  };
  const agent = createAcpAgent({
    input: incoming,
    write: (line) => outgoing.write(line),
    sessionDir: directory,
    configDefaults: options.legacy ? {} : { bridgeHost: 'standalone' },
    hostManager,
    runDefaults: { callerToken: 'test-local-caller-token' },
    runFn:
      options.runFn ||
      (async (args) => {
        calls.push(args);
        // A real runner creates this checkpoint; this stub lets protocol tests
        // test reload without making network calls or reading real sessions.
        fs.writeFileSync(args.sessionPath, '{}', { mode: 0o600 });
        return { stopReason: STOP_REASONS.SUCCESS };
      }),
  });
  const rpc = createConnection({ input: outgoing, write: (line) => incoming.write(line) });
  rpc.onMethod('session/update', (params) => updates.push(params.update));
  t.after(() => {
    incoming.end();
    outgoing.end();
    rpc.close();
  });
  return { directory, calls, hosts, agent, rpc, updates };
}
async function session(c) {
  await c.rpc.request('initialize', { protocolVersion: 2 });
  return c.rpc.request('session/new', { cwd: c.directory });
}
const prompt = (c, sessionId) =>
  c.rpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'hello' }] });
const choose = (c, sessionId, value) =>
  c.rpc.request('session/set_config_option', { sessionId, configId: 'bridge_host', value });

test('discovery is passive; the selector is offered only after launcher opt-in', async (t) => {
  const c = client(t);
  const created = await session(c);
  assert.deepEqual(
    created.configOptions.find((o) => o.id === 'bridge_host').options.map((o) => o.value),
    ['standalone', 'desktop', 'browser', 'vscode'],
  );
  assert.deepEqual(c.calls, []);
  assert.deepEqual(c.hosts, []);
  assert.deepEqual(fs.readdirSync(c.directory), []);
  const legacy = client(t, { legacy: true });
  const old = await session(legacy);
  assert.ok(!old.configOptions.some((o) => o.id === 'bridge_host'));
  await assert.rejects(choose(legacy, old.sessionId, 'desktop'), /Unknown configId/);
  await prompt(legacy, old.sessionId);
  assert.deepEqual(legacy.hosts, []);
  assert.equal(legacy.calls[0].bridgeUrl, undefined);
});

test('four choices route the real run options and preserve the same checkpoint and caller token', async (t) => {
  const c = client(t);
  const { sessionId } = await session(c);
  for (const host of ['standalone', 'vscode', 'desktop', 'browser']) {
    await choose(c, sessionId, host);
    await prompt(c, sessionId);
  }
  assert.deepEqual(c.hosts, ['standalone', 'vscode', 'desktop', 'browser']);
  assert.deepEqual(
    c.calls.map((call) => call.resume),
    [false, true, true, true],
  );
  assert.equal(new Set(c.calls.map((call) => call.sessionPath)).size, 1);
  assert.ok(c.calls.every((call) => call.callerToken === 'test-local-caller-token'));
  assert.ok(c.updates.some((u) => u.title === 'Bridge connection (local)' && u._meta.origin === 'bridge-control'));
  // T3 replaces an omitted update title with "Tool". Keep the local activity
  // identifiable through completion, and give its details plain readable text.
  const progress = c.updates.filter(
    (u) => u.toolCallId?.startsWith('bridge-connection-') && u.sessionUpdate === 'tool_call_update',
  );
  assert.ok(progress.length > 0);
  assert.ok(progress.every((u) => u.title === 'Bridge connection (local)' && typeof u.rawOutput === 'string'));
  assert.equal(fs.statSync(settingsPath(c.directory, sessionId)).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(settingsPath(c.directory, sessionId), 'utf8').includes('token'), false);
});

test('selection survives a fresh process session/load; old checkpoints use the default', async (t) => {
  const c = client(t);
  const { sessionId } = await session(c);
  await choose(c, sessionId, 'vscode');
  await prompt(c, sessionId);
  const next = client(t, { directory: c.directory });
  await next.rpc.request('initialize', {});
  const loaded = await next.rpc.request('session/load', { sessionId, cwd: c.directory });
  assert.equal(loaded.configOptions.find((o) => o.id === 'bridge_host').currentValue, 'vscode');
  await prompt(next, sessionId);
  assert.deepEqual(next.hosts, ['vscode']);
  const firstCard = c.updates.find((u) => u.sessionUpdate === 'tool_call').toolCallId;
  const restoredCard = next.updates.find((u) => u.sessionUpdate === 'tool_call').toolCallId;
  assert.notEqual(restoredCard, firstCard, 'a restarted agent must create a new activity card');
  fs.unlinkSync(settingsPath(c.directory, sessionId));
  assert.equal(readHost(c.directory, sessionId, 'standalone'), 'standalone');
});

test('corrupt or symlinked settings fail explicitly; identifiers cannot escape the session directory', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'host-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const id of ['../outside', '/absolute', 'a/b', 'a\\b'])
    assert.throws(() => settingsPath(directory, id), /Invalid ACP session identifier/);
  const file = settingsPath(directory, 'safe-session');
  fs.writeFileSync(file, '{bad');
  assert.throws(() => readHost(directory, 'safe-session', 'standalone'), /invalid or unreadable/);
  fs.unlinkSync(file);
  const outside = path.join(directory, 'outside');
  fs.writeFileSync(outside, 'unchanged');
  fs.symlinkSync(outside, file);
  assert.throws(() => saveHost(directory, 'safe-session', 'desktop'), /Could not save/);
  assert.throws(() => readHost(directory, 'safe-session', 'standalone'), /invalid or unreadable/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
});

test('a failed settings write leaves the selected host unchanged', async (t) => {
  const c = client(t);
  const { sessionId } = await session(c);
  fs.mkdirSync(settingsPath(c.directory, sessionId));
  await assert.rejects(choose(c, sessionId, 'browser'), /Could not save/);
  assert.equal(c.agent._sessions.get(sessionId).config.bridgeHost, 'standalone');
  assert.deepEqual(c.hosts, []);
});

test('failed preflight never invokes the model, switches hosts, or advances resume state', async (t) => {
  let attempts = 0;
  const c = client(t, {
    hostManager: {
      ensure: async () => {
        attempts++;
        throw new Error('Not available');
      },
    },
  });
  const { sessionId } = await session(c);
  await choose(c, sessionId, 'vscode');
  await assert.rejects(prompt(c, sessionId), /Not available/);
  assert.equal(attempts, 1);
  assert.deepEqual(c.calls, []);
  assert.equal(c.agent._sessions.get(sessionId).turnCount, 0);
  assert.equal(c.agent._sessions.get(sessionId).config.bridgeHost, 'vscode');
  const reopened = client(t, { directory: c.directory });
  await reopened.rpc.request('initialize', {});
  const restored = await reopened.rpc.request('session/load', { sessionId, cwd: c.directory });
  assert.equal(restored.configOptions.find((o) => o.id === 'bridge_host').currentValue, 'vscode');
  await prompt(reopened, sessionId);
  assert.equal(reopened.calls[0].resume, false);
});

test('changes while starting a host apply only to the next turn', async (t) => {
  let release;
  let entered;
  const reached = new Promise((resolve) => {
    entered = resolve;
  });
  const seen = [];
  const c = client(t, {
    hostManager: {
      ensure: async (host) => {
        seen.push(host);
        if (seen.length === 1) {
          entered();
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        return { bridgeUrl: 'http://127.0.0.1/' + host };
      },
    },
  });
  const { sessionId } = await session(c);
  const active = prompt(c, sessionId);
  await reached;
  await choose(c, sessionId, 'desktop');
  await c.rpc.request('session/set_config_option', { sessionId, configId: 'effort', value: 'low' });
  release();
  await active;
  await prompt(c, sessionId);
  assert.deepEqual(seen, ['standalone', 'desktop']);
  assert.equal(c.calls[0].bridgeUrl, 'http://127.0.0.1/standalone');
  assert.equal(c.calls[0].effort, undefined);
  assert.equal(c.calls[1].effort, 'low');
});

test('cancel during host startup sends no model request and the next prompt still works', async (t) => {
  let entered;
  let first = true;
  const reached = new Promise((resolve) => {
    entered = resolve;
  });
  const c = client(t, {
    hostManager: {
      ensure: async (_host, { signal }) => {
        if (!first) return { bridgeUrl: 'http://127.0.0.1:11467/v1/messages' };
        first = false;
        entered();
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    },
  });
  const { sessionId } = await session(c);
  const active = prompt(c, sessionId);
  await reached;
  c.rpc.notify('session/cancel', { sessionId });
  assert.equal((await active).stopReason, 'cancelled');
  assert.deepEqual(c.calls, []);
  assert.equal((await prompt(c, sessionId)).stopReason, 'end_turn');
  assert.equal(c.calls[0].resume, false);
});

test('new launcher discovers controls over clean stdout without starting a bridge', async (t) => {
  const child = spawn(path.resolve('bin/t3-bridge-runner.sh'), [], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      BRIDGE_RUNNER_NODE: process.execPath,
      BRIDGE_RUNNER_HOST: 'vscode',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk;
  });
  const rpc = createConnection({ input: child.stdout, write: (line) => child.stdin.write(line) });
  t.after(() => {
    rpc.close();
    child.stdin.end();
    child.kill();
  });
  const initialized = await rpc.request('initialize', {});
  assert.equal(initialized.agentInfo.name, 'bridge-runner-acp');
  const created = await rpc.request('session/new', { cwd: os.tmpdir() });
  assert.equal(created.configOptions.find((o) => o.id === 'bridge_host').currentValue, 'vscode');
  assert.equal(diagnostics, '');
});
