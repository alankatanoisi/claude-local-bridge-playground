'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { execute } = require('../../src/runner/tools/write-file');

describe('write_file tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-file-'));
  const ctx = { cwd: tmpDir };

  it('creates a new file', () => {
    const result = execute({ path: 'new.js', content: '// hello world' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('created'));
    const content = fs.readFileSync(path.join(tmpDir, 'new.js'), 'utf8');
    assert.equal(content, '// hello world');
  });

  it('overwrites an existing file', () => {
    const filePath = path.join(tmpDir, 'existing.js');
    fs.writeFileSync(filePath, 'old content');
    const result = execute({ path: 'existing.js', content: 'new content' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('overwritten'));
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content, 'new content');
  });

  it('rejects content over 50KB', () => {
    const big = 'x'.repeat(50001);
    const result = execute({ path: 'big.js', content: big }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('too large'));
  });

  it('creates intermediate directories', () => {
    const result = execute({ path: 'deep/nested/file.js', content: '// deep' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(path.join(tmpDir, 'deep', 'nested', 'file.js')));
  });

  it('records undo metadata when overwriting a file', () => {
    const filePath = path.join(tmpDir, 'undo-write.js');
    fs.writeFileSync(filePath, 'old');
    const undoCtx = { cwd: tmpDir, undoLog: [], toolUseId: 'tu-write' };
    const result = execute({ path: 'undo-write.js', content: 'new' }, undoCtx);
    assert.equal(result.ok, true);
    assert.equal(undoCtx.undoLog.length, 1);
    assert.equal(undoCtx.undoLog[0].tool_use_id, 'tu-write');
    assert.ok(undoCtx.undoLog[0].backup_path);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'new');
  });

  it('keeps backups inside the project directory', () => {
    const filePath = path.join(tmpDir, 'project-backup.js');
    fs.writeFileSync(filePath, 'old');
    const result = execute({ path: 'project-backup.js', content: 'new' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.backupPath.startsWith(path.join(tmpDir, '.bridge-runner')));
  });

  it('rejects missing content argument', () => {
    const result = execute({ path: 'no-content.js' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Missing required content'));
  });

  it('rejects path that escapes working directory', () => {
    const result = execute({ path: '../../../etc/passwd', content: 'hack' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('escapes'));
  });
});
