'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createThrowawayLab, stamp } = require('../../scripts/create-runner-throwaway-lab');

describe('throwaway runner lab helper', () => {
  it('uses a stable timestamp folder name', () => {
    assert.equal(stamp(new Date('2026-05-30T12:34:56.000Z')), '20260530-123456');
  });

  it('creates a fresh calculator lab with a failing multiply test', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-labs-'));
    const labDir = createThrowawayLab({ baseDir, now: new Date('2026-05-30T12:34:56.000Z') });

    assert.equal(path.basename(labDir), 'lab-20260530-123456');
    assert.ok(fs.existsSync(path.join(labDir, 'package.json')));
    assert.ok(fs.existsSync(path.join(labDir, 'src', 'calc.js')));
    assert.ok(fs.existsSync(path.join(labDir, 'test', 'calc.test.js')));

    assert.throws(() => execFileSync('node', ['test/calc.test.js'], { cwd: labDir, stdio: 'pipe' }), /Command failed/);
  });
});
