'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DIR_MODE,
  FILE_MODE,
  ensurePrivateDir,
  privateWriteFileSync,
  privateAppendFileSync,
  privateAtomicWriteSync,
  openPrivateAppend,
  modeBits,
} = require('../../src/runner/private-fs');

const skipModes = process.platform === 'win32';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-private-fs-'));
}

describe('P0-12 private-fs', () => {
  it('creates directories at 0700 and files at 0600', { skip: skipModes }, () => {
    const root = tempRoot();
    const dir = path.join(root, 'nested', 'dir');
    ensurePrivateDir(dir);
    assert.equal(modeBits(dir), DIR_MODE);

    const file = path.join(dir, 'secret.json');
    privateWriteFileSync(file, '{"ok":true}\n');
    assert.equal(modeBits(file), FILE_MODE);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}\n');
  });

  it('tightens a pre-existing looser directory', { skip: skipModes }, () => {
    const root = tempRoot();
    const dir = path.join(root, 'loose');
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    assert.equal(modeBits(dir), 0o755);
    ensurePrivateDir(dir);
    assert.equal(modeBits(dir), DIR_MODE);
  });

  it('atomic rename path keeps 0600 on the final file', { skip: skipModes }, () => {
    const root = tempRoot();
    const file = path.join(root, 'atomic.json');
    privateAtomicWriteSync(file, '{"a":1}\n');
    assert.equal(modeBits(file), FILE_MODE);
    assert.ok(!fs.existsSync(file + '.tmp.' + process.pid));
  });

  it('append and openPrivateAppend create private files', { skip: skipModes }, () => {
    const root = tempRoot();
    const file = path.join(root, 'log.jsonl');
    privateAppendFileSync(file, '{"n":1}\n');
    assert.equal(modeBits(file), FILE_MODE);

    const fd = openPrivateAppend(file);
    fs.writeSync(fd, '{"n":2}\n');
    fs.closeSync(fd);
    assert.equal(modeBits(file), FILE_MODE);
    assert.match(fs.readFileSync(file, 'utf8'), /"n":2/);
  });
});
