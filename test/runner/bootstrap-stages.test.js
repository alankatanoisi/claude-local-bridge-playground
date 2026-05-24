'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { STAGES, runBootstrap } = require('../../src/runner/bootstrap');

describe('bootstrap stages', () => {
  it('exports ordered stages ending in ready', () => {
    assert.ok(STAGES.includes('workspace_trust'));
    assert.equal(STAGES[STAGES.length - 1], 'ready');
  });

  it('blocks untrusted workspace in non-interactive mode', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
    const origHome = process.env.HOME;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-home-'));
    const origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const r = await runBootstrap({ cwd: tmp, quiet: true });
      assert.equal(r.blocked, true);
      assert.equal(r.stopReason, 'workspace_not_trusted');
    } finally {
      process.env.HOME = origHome;
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });

  it('passes trust gate with trustWorkspace flag', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-trust-'));
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-home2-'));
    const r = await runBootstrap({ cwd: tmp, trustWorkspace: true, quiet: true });
    assert.equal(r.blocked, false);
    assert.ok(r.stagesCompleted.includes('workspace_trust'));
    assert.ok(r.stagesCompleted.includes('ready'));
  });
});
