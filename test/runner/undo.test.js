'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execute } = require('../../src/runner/tools/undo');
const { saveBackup } = require('../../src/runner/tools/file-write-utils');
const writeFile = require('../../src/runner/tools/write-file');
const undoEdit = require('../../src/runner/tools/undo-edit');

describe('undo tool (P1-08)', () => {
  it('reports no backups when directory does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-empty-'));
    const result = execute({}, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('does not exist'));
  });

  it('lists timestamped writer backups', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-list-'));
    const filePath = path.join(tmpDir, 'server.js');
    fs.writeFileSync(filePath, 'v1');
    saveBackup(filePath, Buffer.from('v0'), tmpDir);

    const result = execute({}, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('server.js-'), 'lists timestamped backup name');
    assert.ok(result.text.includes('.bak'));
  });

  it('restores from the newest matching timestamped backup', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-restore-'));
    const filePath = path.join(tmpDir, 'target.js');
    fs.writeFileSync(filePath, 'current');
    const older = saveBackup(filePath, Buffer.from('old-content'), tmpDir);
    // Ensure newer mtime
    const newer = saveBackup(filePath, Buffer.from('new-backup'), tmpDir);
    assert.notEqual(older, newer);

    const result = execute({ path: 'target.js' }, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('Restored'));
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'new-backup');
  });

  it('still accepts legacy exact basename.bak backups', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-legacy-'));
    const filePath = path.join(tmpDir, 'legacy.js');
    fs.writeFileSync(filePath, 'current');
    const backupsDir = path.join(tmpDir, '.bridge-runner', 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, 'legacy.js.bak'), 'legacy-backup');

    const result = execute({ path: 'legacy.js' }, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'legacy-backup');
  });

  it('errors when no backup exists for path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-miss-'));
    fs.mkdirSync(path.join(tmpDir, '.bridge-runner', 'backups'), { recursive: true });
    const result = execute({ path: 'nonexistent.js' }, { cwd: tmpDir });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('No backup found'));
  });
});

describe('write_file + undo_edit create recovery (P1-08)', () => {
  it('marks creates and lets undo_edit delete them', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-create-'));
    const ctx = { cwd: tmpDir, undoLog: [], toolUseId: 'tu-create' };
    const wrote = writeFile.execute({ path: 'new.txt', content: 'hello' }, ctx);
    assert.equal(wrote.ok, true);
    assert.equal(ctx.undoLog[0].created, true);
    assert.equal(ctx.undoLog[0].backup_path, null);
    assert.ok(fs.existsSync(path.join(tmpDir, 'new.txt')));

    const undo = undoEdit.execute({ tool_use_id: 'tu-create' }, ctx);
    assert.equal(undo.ok, true);
    assert.ok(undo.text.includes('deleted'));
    assert.equal(fs.existsSync(path.join(tmpDir, 'new.txt')), false);
  });

  it('fails closed when overwrite backup cannot be written', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-failbak-'));
    const filePath = path.join(tmpDir, 'notes.txt');
    fs.writeFileSync(filePath, 'original');
    // Make backups dir a file so saveBackup cannot create it.
    const bridgeDir = path.join(tmpDir, '.bridge-runner');
    fs.mkdirSync(bridgeDir);
    fs.writeFileSync(path.join(bridgeDir, 'backups'), 'not-a-dir');

    const result = writeFile.execute({ path: 'notes.txt', content: 'overwrite' }, { cwd: tmpDir, undoLog: [] });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Backup failed'));
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'original', 'file left untouched');
  });
});
