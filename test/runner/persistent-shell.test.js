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

  it('starts every command in the same working directory', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const a = await shell.run('pwd');
    const b = await shell.run('pwd');
    assert.equal(a.exitCode, 0);
    assert.equal(b.exitCode, 0);
    assert.equal(a.stdout.trim(), b.stdout.trim(), 'cwd is stable across calls');
    shell.shutdown();
  });

  // Owner decision 2026-11-12. This test used to assert the opposite
  // ("preserves shell variables across calls"). Carried state let one permitted
  // command change what a later one could read, past the per-command shell
  // scanner — see persistent-shell-cross-call.test.js. Each command now gets
  // its own bash process.
  it('does not carry variables, shell options, or the current folder between calls', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    const first = await shell.run('export MY_VAR=stickyvalue; shopt -s dotglob; cd sub; echo $$');
    assert.equal(first.exitCode, 0);
    // `shopt -q NAME` exits 1 when the option is off.
    const second = await shell.run('shopt -q dotglob; echo "$$ [${MY_VAR:-absent}] dotglob=$? $PWD"');
    assert.equal(second.exitCode, 0);
    const [pid, variable, option, folder] = second.stdout.trim().split(' ');
    assert.notEqual(pid, first.stdout.trim(), 'a used bash process never runs a second command');
    assert.equal(variable, '[absent]');
    assert.equal(option, 'dotglob=1');
    assert.equal(folder, fs.realpathSync(tmpDir));
    shell.shutdown();
  });

  it('pre-starts the next bash after a command, and the next command uses exactly that one', async () => {
    const shell = new PersistentShell({ cwd: tmpDir, env: baseEnv });
    assert.equal(shell.child, null, 'nothing is started until the first command needs it');
    await shell.run('true');
    // The replacement is started on the next turn of the event loop, after the
    // finished command's result has been handed back.
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(shell.child, 'a bash is waiting before the next command is requested');
    const waitingPid = shell.child.pid;
    assert.equal(typeof waitingPid, 'number');
    const next = await shell.run('echo $$');
    assert.equal(next.stdout.trim(), String(waitingPid), 'the waiting bash served the next command');
    shell.shutdown();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(shell.child, null, 'shutdown leaves no bash waiting, even if a pre-start was pending');
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
    // The hung process was killed; the next call must succeed against a fresh child.
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
