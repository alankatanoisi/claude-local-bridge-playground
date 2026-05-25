'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const fingerprintMod = require('../../src/runner/workspace-fingerprint');

function fresh(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wf-' + label + '-'));
}

describe('Ext-10 workspace fingerprint', () => {
  it('returns a stable fingerprint across calls for an unchanged workspace', () => {
    const cwd = fresh('stable');
    const a = fingerprintMod.compute(cwd);
    const b = fingerprintMod.compute(cwd);
    assert.equal(a.fingerprint, b.fingerprint);
  });

  it('changes when CLAUDE.md content changes', () => {
    const cwd = fresh('claude');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v1');
    const a = fingerprintMod.compute(cwd);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v2');
    const b = fingerprintMod.compute(cwd);
    assert.notEqual(a.fingerprint, b.fingerprint);
  });

  it('changes when git dirty status changes', () => {
    const cwd = fresh('git');
    execFileSync('git', ['init', '-q'], { cwd });
    const a = fingerprintMod.compute(cwd);
    fs.writeFileSync(path.join(cwd, 'a.txt'), '1');
    const b = fingerprintMod.compute(cwd);
    assert.notEqual(a.fingerprint, b.fingerprint, 'dirty hash changed when new file appears');
  });

  it('persists via write/read and detects change via changed()', () => {
    const cwd = fresh('persist');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'one');
    const a = fingerprintMod.compute(cwd);
    fingerprintMod.write(cwd, a);
    const restored = fingerprintMod.read(cwd);
    assert.equal(restored.fingerprint, a.fingerprint);
    assert.equal(fingerprintMod.changed(restored, a), false);

    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'two');
    const b = fingerprintMod.compute(cwd);
    assert.equal(fingerprintMod.changed(restored, b), true);
  });

  it('returns null fingerprint when cwd is missing', () => {
    const r = fingerprintMod.compute(null);
    assert.equal(r.fingerprint, null);
  });

  it('read() returns null on a fresh workspace', () => {
    const cwd = fresh('fresh-read');
    assert.equal(fingerprintMod.read(cwd), null);
  });
});
