'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execute } = require('../../src/runner/tools/undo');

describe('undo tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-'));
  const ctx = { cwd: tmpDir };

  it('reports no backups when directory does not exist', () => {
    const result = execute({}, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('does not exist'));
  });

  it('lists available backups', () => {
    const backupsDir = path.join(tmpDir, '.bridge-runner', 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, 'server.js.bak'), 'backup content');
    fs.writeFileSync(path.join(backupsDir, 'index.js.bak'), 'other backup');

    const result = execute({}, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('server.js.bak'));
    assert.ok(result.text.includes('index.js.bak'));
  });

  it('restores a file from backup', () => {
    const filePath = path.join(tmpDir, 'target.js');
    fs.writeFileSync(filePath, 'current content');
    const backupsDir = path.join(tmpDir, '.bridge-runner', 'backups');
    fs.writeFileSync(path.join(backupsDir, 'target.js.bak'), 'backup content');

    const result = execute({ path: 'target.js' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('Restored'));

    const restored = fs.readFileSync(filePath, 'utf8');
    assert.equal(restored, 'backup content');
  });

  it('errors when no backup exists for path', () => {
    const result = execute({ path: 'nonexistent.js' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('No backup found'));
  });
});
