'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { check, isHardDeny } = require('../../src/runner/permissions');
const { executeForce } = require('../../src/runner/tool-registry');
const path = require('path');
const os = require('os');
const fs = require('fs');

describe('permission explainer', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-expl-'));

  it('includes severity and explanation on deny', () => {
    const perm = check('read_file', { path: '.env' }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(perm.decision, 'deny');
    assert.equal(perm.severity, 'hard_deny');
    assert.ok(perm.explanation);
    assert.equal(isHardDeny(perm), true);
  });

  it('includes explanation on allow', () => {
    const perm = check('read_file', { path: 'readme.txt' }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(perm.decision, 'allow');
    assert.ok(perm.explanation);
  });
});

describe('chaos-ok path guards', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-'));

  it('hard_deny survives executeForce with chaos flags', async () => {
    const result = await executeForce(
      'bash',
      { command: 'cat .env' },
      {
        cwd: tmpDir,
        cwdRealpath: fs.realpathSync(tmpDir),
        allowShell: true,
        acceptEdits: true,
        dontAsk: true,
        chaosOk: true,
      },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /blocked path pattern|Permission denied/i);
    assert.equal(result.permission?.severity, 'hard_deny');
  });
});
