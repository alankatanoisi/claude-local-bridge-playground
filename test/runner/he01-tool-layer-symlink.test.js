'use strict';

/**
 * HE-01 tool-layer defense-in-depth: read_file / edit_file / list_files /
 * write_file must refuse Safari-2 shapes even if the permission gate were
 * skipped. Pattern matches glob.js + resolveFileTarget.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const readFile = require('../../src/runner/tools/read-file');
const editFile = require('../../src/runner/tools/edit-file');
const listFiles = require('../../src/runner/tools/list-files');
const writeFile = require('../../src/runner/tools/write-file');

describe('HE-01 tool-layer symlink / deny-matrix defense', () => {
  let tmp;
  let ctx;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'he01-tools-'));
    fs.writeFileSync(path.join(tmp, '.env'), 'FAKE_SECRET=not-a-real-secret\n');
    fs.writeFileSync(path.join(tmp, 'ok.txt'), 'hello TODO\n');
    fs.symlinkSync('.env', path.join(tmp, 'notes.txt'));
    // Out-of-root escape: symlink to a deny-listed basename outside cwd.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'he01-out-'));
    fs.writeFileSync(path.join(outsideDir, '.env'), 'OUTSIDE=1\n');
    fs.symlinkSync(path.join(outsideDir, '.env'), path.join(tmp, 'escape.txt'));
    ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    ctx._outsideDir = outsideDir;
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (ctx._outsideDir) fs.rmSync(ctx._outsideDir, { recursive: true, force: true });
  });

  it('read_file refuses in-root symlink to .env', () => {
    const r = readFile.execute({ path: 'notes.txt' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.text, /deny matrix|not allowed|Blocked/i);
  });

  it('read_file refuses direct .env', () => {
    const r = readFile.execute({ path: '.env' }, ctx);
    assert.equal(r.ok, false);
  });

  it('read_file refuses out-of-root escape symlink', () => {
    const r = readFile.execute({ path: 'escape.txt' }, ctx);
    assert.equal(r.ok, false);
  });

  it('read_file still allows a normal file', () => {
    const r = readFile.execute({ path: 'ok.txt' }, ctx);
    assert.equal(r.ok, true);
    assert.match(r.text, /hello/);
  });

  it('list_files hides .env and the notes.txt alias', () => {
    const r = listFiles.execute({ path: '.' }, ctx);
    assert.equal(r.ok, true);
    assert.doesNotMatch(r.text, /\.env/);
    assert.doesNotMatch(r.text, /notes\.txt/);
    assert.doesNotMatch(r.text, /escape\.txt/);
    assert.match(r.text, /ok\.txt/);
  });

  it('edit_file refuses symlink target', () => {
    const r = editFile.execute({ path: 'notes.txt', old_string: 'FAKE', new_string: 'X' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.text, /symlink|deny matrix|Blocked|not allowed/i);
  });

  it('write_file refuses symlink overwrite', () => {
    const r = writeFile.execute({ path: 'notes.txt', content: 'x' }, ctx);
    assert.equal(r.ok, false);
  });

  it('write_file refuses direct .env', () => {
    const r = writeFile.execute({ path: '.env', content: 'x' }, ctx);
    assert.equal(r.ok, false);
  });
});
