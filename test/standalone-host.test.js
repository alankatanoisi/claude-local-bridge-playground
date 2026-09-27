'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { validateConfig, parseArguments } = require('../src/standalone');
const { freePort, plist } = require('../src/hosting/control');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function launch(directory, port, required = true) {
  const config = path.join(directory, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ port, requireCallerAuth: required }), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [path.resolve('bin/local-bridge-standalone.js'), '--config', config, '--state-dir', directory],
    {
      // A synthetic token avoids reading this developer's real Keychain. No
      // model request is sent by these deterministic boundary checks.
      env: {
        ...process.env,
        CLAUDE_CODE_OAUTH_TOKEN: 'synthetic-oauth-only-test',
        ANTHROPIC_API_KEY: 'must-never-be-used',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  return { child, exited, output: () => output };
}
async function ready(port, processState) {
  for (let i = 0; i < 100; i++) {
    if (processState.child.exitCode !== null) throw new Error(processState.output());
    try {
      if (
        (await fetch(`http://127.0.0.1:${port}`, { method: 'OPTIONS', headers: { Origin: 'http://localhost' } }))
          .status === 204
      )
        return;
    } catch {
      /* Wait for the child to bind its listener. */
    }
    await pause(30);
  }
  throw new Error('Child did not start');
}

test('standalone config is explicit and rejects upstream/auth bypass settings', () => {
  assert.throws(() => validateConfig({ port: 0 }), /port/);
  assert.throws(() => validateConfig({ port: 12345, anthropicBaseUrl: 'https://other.example' }), /Unsupported/);
  assert.throws(() => validateConfig({ port: 12345, requireCallerAuth: 'false' }), /true or false/);
  assert.throws(() => parseArguments(['--config']), /Usage/);
  assert.throws(() => parseArguments(['--host', '0.0.0.0']), /Usage/);
  assert.equal(validateConfig({ port: 12345 }).strictPort, true);
});

test(
  'plain Node child preserves routing/auth, redacts logs, persists local auth and shuts down',
  { timeout: 20000 },
  async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-standalone-test-'));
    const port = await unusedPort();
    let state = launch(directory, port);
    t.after(async () => {
      if (state.child.exitCode === null) state.child.kill('SIGTERM');
      await state.exited;
      fs.rmSync(directory, { recursive: true, force: true });
    });
    await ready(port, state);
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(base + '/v1/debug')).status, 401);
    assert.equal((await fetch(base, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(base + '/v1/messages/count_tokens', { method: 'POST' })).status, 401);
    const secrets = JSON.parse(fs.readFileSync(path.join(directory, 'caller-secrets.json')));
    const token = secrets['claudeLocalBridge.callerAuthToken'];
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(base + '/v1/messages/count_tokens', { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(base + '/v1/messages', { method: 'POST', headers, body: '{bad' })).status, 400);
    assert.equal((await fetch(base + '/v1/models', { headers })).status, 404);
    assert.equal((await fetch(base + '/v1/chat/completions', { method: 'POST', headers })).status, 404);
    const debugToken = JSON.parse(fs.readFileSync(path.join(directory, 'debug-token.json'))).token;
    const debug = await (
      await fetch(base + '/v1/debug', { headers: { 'x-claude-local-bridge-debug-token': debugToken } })
    ).json();
    assert.equal(debug.credentialSource, 'env:CLAUDE_CODE_OAUTH_TOKEN');
    assert.equal(debug.upstreamAuthMode, 'bearer');
    for (const secret of [token, debugToken, 'synthetic-oauth-only-test', 'must-never-be-used'])
      assert.ok(!state.output().includes(secret));
    assert.equal(fs.statSync(path.join(directory, 'caller-secrets.json')).mode & 0o777, 0o600);
    // A duplicate using this same state directory must preserve our door code.
    const duplicate = launch(directory, port);
    assert.equal((await duplicate.exited).code, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'debug-token.json'))).token, debugToken);
    assert.equal(
      (await fetch(base + '/v1/debug', { headers: { 'x-claude-local-bridge-debug-token': debugToken } })).status,
      200,
    );
    state.child.kill('SIGTERM');
    assert.equal((await state.exited).code, 0);
    await freePort(port);
    state = launch(directory, port);
    await ready(port, state);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, 'caller-secrets.json')))['claudeLocalBridge.callerAuthToken'],
      token,
    );
  },
);

test('busy standalone port fails instead of silently moving or stopping its owner', { timeout: 10000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-busy-test-'));
  const owner = net.createServer();
  await new Promise((resolve) => owner.listen(0, '127.0.0.1', resolve));
  try {
    const port = owner.address().port;
    await assert.rejects(freePort(port), /occupied/);
    const state = launch(directory, port, false);
    const result = await Promise.race([
      state.exited,
      pause(5000).then(() => {
        state.child.kill();
        throw new Error('Busy child hung');
      }),
    ]);
    assert.equal(result.code, 1);
    assert.equal(owner.listening, true);
    assert.ok(!state.output().includes('Standalone bridge ready'));
  } finally {
    await new Promise((resolve) => owner.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('launchd descriptions escape paths and limit ownership to dedicated labels', () => {
  const output = plist('standalone', ['/path with spaces/node', 'a&b<.js'], '/private/log', '/workspace');
  assert.match(output, /org\.alan\.claude-bridge-lab\.standalone/);
  assert.match(output, /a&amp;b&lt;\.js/);
  assert.match(output, /<key>Umask<\/key><integer>63<\/integer>/);
  assert.ok(!output.includes('pkill'));
});

test('controller lock is exclusive and automatically released after interruption', { timeout: 10000 }, async () => {
  const { withLock } = require('../src/hosting/control');
  const port = await unusedPort();
  await withLock(async () => {
    await assert.rejects(
      withLock(async () => {}, port),
      /active/,
    );
  }, port);
  const modulePath = path.resolve('src/hosting/control.js');
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require(${JSON.stringify(modulePath)}).withLock(async()=>{process.stdout.write('LOCKED'); await new Promise(()=>{})},${port})`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
    });
    await assert.rejects(
      withLock(async () => {}, port),
      /active/,
    );
    child.kill('SIGKILL');
    await exited;
    let ran = false;
    await withLock(async () => {
      ran = true;
    }, port);
    assert.equal(ran, true);
    const results = await Promise.allSettled([
      withLock(async () => {
        await pause(100);
      }, port),
      withLock(async () => {
        await pause(100);
      }, port),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('standalone shutdown is bounded even with an unfinished request body', { timeout: 10000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-shutdown-test-'));
  const port = await unusedPort();
  const state = launch(directory, port, false);
  let socket;
  try {
    await ready(port, state);
    socket = net.connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write('POST /v1/messages HTTP/1.1\r\nHost: localhost\r\nContent-Length: 9999\r\n\r\n{');
    const before = Date.now();
    state.child.kill('SIGTERM');
    assert.equal((await state.exited).code, 0);
    assert.ok(Date.now() - before < 6000);
    await freePort(port);
  } finally {
    socket?.destroy();
    if (state.child.exitCode === null) state.child.kill('SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('post-bind initialization failure closes the server and exits unsuccessfully', { timeout: 10000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-init-failure-'));
  const port = await unusedPort();
  fs.mkdirSync(path.join(directory, 'debug-token.json'));
  const state = launch(directory, port, false);
  try {
    const result = await Promise.race([
      state.exited,
      pause(5000).then(() => {
        state.child.kill();
        throw new Error('Failed startup kept listening');
      }),
    ]);
    assert.equal(result.code, 1);
    await freePort(port);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
