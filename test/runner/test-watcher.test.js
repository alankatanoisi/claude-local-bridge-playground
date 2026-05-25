'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const watcher = require('../../src/runner/test-watcher');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'watch-' + label + '-'));
}

describe('Ext-13 test-watcher', () => {
  it('returns null when no test command is discoverable', () => {
    const cwd = tmp('none');
    assert.equal(watcher.detectTestCommand(cwd), null);
  });

  it('finds package.json scripts.test', () => {
    const cwd = tmp('pkg');
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const cmd = watcher.detectTestCommand(cwd);
    assert.ok(cmd);
    assert.equal(cmd.source, 'package.json');
    assert.match(cmd.command, /npm test/);
  });

  it('finds pyproject.toml pytest config', () => {
    const cwd = tmp('py');
    fs.writeFileSync(path.join(cwd, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    const cmd = watcher.detectTestCommand(cwd);
    assert.ok(cmd);
    assert.equal(cmd.source, 'pyproject.toml');
    assert.match(cmd.command, /pytest/);
  });

  it('env override beats project detection', () => {
    const cwd = tmp('env');
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    const prev = process.env.BRIDGE_RUNNER_TEST_CMD;
    process.env.BRIDGE_RUNNER_TEST_CMD = 'echo hi';
    try {
      const cmd = watcher.detectTestCommand(cwd);
      assert.equal(cmd.source, 'env');
      assert.equal(cmd.command, 'echo hi');
    } finally {
      if (prev === undefined) delete process.env.BRIDGE_RUNNER_TEST_CMD;
      else process.env.BRIDGE_RUNNER_TEST_CMD = prev;
    }
  });

  it('runIfEnabled returns disabled when not allowed', () => {
    const r = watcher.runIfEnabled({ cwd: '/tmp', cwdRealpath: '/tmp', allowShell: false });
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'disabled');
  });

  it('runIfEnabled actually runs when fully configured', () => {
    const cwd = tmp('run');
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'echo ok' } }));
    const prevWatch = process.env.BRIDGE_RUNNER_TEST_WATCH;
    const prevCmd = process.env.BRIDGE_RUNNER_TEST_CMD;
    process.env.BRIDGE_RUNNER_TEST_WATCH = '1';
    process.env.BRIDGE_RUNNER_TEST_CMD = 'echo ok';
    try {
      const r = watcher.runIfEnabled({ cwd, cwdRealpath: fs.realpathSync(cwd), allowShell: true });
      assert.equal(r.ran, true);
      assert.equal(r.ok, true);
      assert.match(r.stdout, /ok/);
    } finally {
      if (prevWatch === undefined) delete process.env.BRIDGE_RUNNER_TEST_WATCH;
      else process.env.BRIDGE_RUNNER_TEST_WATCH = prevWatch;
      if (prevCmd === undefined) delete process.env.BRIDGE_RUNNER_TEST_CMD;
      else process.env.BRIDGE_RUNNER_TEST_CMD = prevCmd;
    }
  });
});
