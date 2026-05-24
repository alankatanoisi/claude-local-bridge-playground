'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PersistentShell, getShell, isEnabled, reset } = require('../../src/runner/tools/persistent-shell');

// Skip the whole suite on non-POSIX where /bin/bash is unlikely to exist.
const hasBash = (() => {
  try {
    fs.accessSync('/bin/bash', fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
})();

describe('persistent-shell', { skip: !hasBash }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pshell-'));
  const baseEnv = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: tmpDir };

  before(() => {
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n');
  });

  after(() => {
    reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs a command and returns stdout + exit code', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const result = await shell.run('cat a.txt');
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello'));
    shell.shutdown();
  });

  it('preserves cwd across multiple commands', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const a = await shell.run('pwd');
    const b = await shell.run('pwd');
    assert.equal(a.exitCode, 0);
    assert.equal(b.exitCode, 0);
    assert.equal(a.stdout.trim(), b.stdout.trim(), 'cwd is stable across calls');
    shell.shutdown();
  });

  it('preserves shell variables across calls (the whole point of being persistent)', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const set = await shell.run('export MY_VAR=stickyvalue');
    assert.equal(set.exitCode, 0);
    const read = await shell.run('echo "[$MY_VAR]"');
    assert.equal(read.exitCode, 0);
    assert.ok(read.stdout.includes('[stickyvalue]'), 'variable survives between calls');
    shell.shutdown();
  });

  it('captures non-zero exit codes', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const result = await shell.run('false');
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 1);
    shell.shutdown();
  });

  it('times out and reports it without leaking the hung process', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const result = await shell.run('sleep 5', { timeout: 200 });
    assert.equal(result.ok, true);
    assert.equal(result.timedOut, true);
    // Shell got killed; the next call must succeed against a fresh child.
    const after = await shell.run('echo recovered');
    assert.equal(after.exitCode, 0);
    assert.ok(after.stdout.includes('recovered'));
    shell.shutdown();
  });

  it('respawns when cwd or env changes', () => {
    reset();
    const a = getShell(tmpDir, baseEnv);
    const b = getShell(tmpDir, baseEnv);
    assert.equal(a, b, 'same cwd+env reuses the shell');

    const otherEnv = { ...baseEnv, EXTRA: '1' };
    const c = getShell(tmpDir, otherEnv);
    assert.notEqual(a, c, 'different env forces a new shell');
  });

  it('is opt-in via BRIDGE_RUNNER_PERSISTENT_SHELL', () => {
    const saved = process.env.BRIDGE_RUNNER_PERSISTENT_SHELL;
    try {
      delete process.env.BRIDGE_RUNNER_PERSISTENT_SHELL;
      assert.equal(isEnabled(), false);
      process.env.BRIDGE_RUNNER_PERSISTENT_SHELL = '1';
      assert.equal(isEnabled(), true);
      process.env.BRIDGE_RUNNER_PERSISTENT_SHELL = '0';
      assert.equal(isEnabled(), false);
    } finally {
      if (saved === undefined) delete process.env.BRIDGE_RUNNER_PERSISTENT_SHELL;
      else process.env.BRIDGE_RUNNER_PERSISTENT_SHELL = saved;
    }
  });
});
