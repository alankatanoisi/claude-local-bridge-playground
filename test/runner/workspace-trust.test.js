'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  loadTrustStore,
  saveTrustStore,
  recordTrust,
  isTrusted,
  fingerprintCwd,
} = require('../../src/runner/workspace-trust');

describe('workspace trust', () => {
  let tmpHome;
  let origHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-home-'));
    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
  });

  it('records and checks trust for a cwd realpath', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-cwd-'));
    const real = fs.realpathSync(cwd);
    assert.equal(isTrusted(real), false);
    recordTrust(real);
    assert.equal(isTrusted(real), true);
    const store = loadTrustStore();
    assert.equal(store.workspaces.length, 1);
    assert.equal(store.workspaces[0].fingerprint, fingerprintCwd(real));
  });

  it('fails closed when fingerprint mismatches', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-cwd2-'));
    const real = fs.realpathSync(cwd);
    saveTrustStore({ workspaces: [{ cwdRealpath: real, fingerprint: 'bad', trustedAt: 'x' }] });
    assert.equal(isTrusted(real), false);
  });
});
