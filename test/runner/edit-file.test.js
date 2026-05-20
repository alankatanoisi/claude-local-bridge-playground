'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Test the edit_file tool directly (bypassing permission check)
const { execute } = require('../../src/runner/tools/edit-file');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('edit_file tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-file-'));
  const ctx = { cwd: tmpDir };

  it('replaces a single occurrence', () => {
    const filePath = path.join(tmpDir, 'test.js');
    fs.writeFileSync(filePath, 'const x = 1;\nconst y = 2;\n');
    const result = execute({ path: 'test.js', old_string: 'const x = 1;', new_string: 'const x = 42;' }, ctx);
    assert.equal(result.ok, true);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('const x = 42;'));
    assert.ok(result.diff);
    assert.ok(result.backupPath);
  });

  it('fails when old_string not found', () => {
    const filePath = path.join(tmpDir, 'notfound.js');
    fs.writeFileSync(filePath, 'line one\nline two\n');
    const result = execute({ path: 'notfound.js', old_string: 'nonexistent', new_string: 'x' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('not found'));
  });

  it('fails when old_string matches multiple times', () => {
    const filePath = path.join(tmpDir, 'multi.js');
    fs.writeFileSync(filePath, 'hello\nhello\n');
    const result = execute({ path: 'multi.js', old_string: 'hello', new_string: 'bye' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('matched 2 times'));
  });

  it('handles multi-line replacement', () => {
    const filePath = path.join(tmpDir, 'multiline.js');
    fs.writeFileSync(filePath, 'line one\nline two\nline three\nline four\n');
    const result = execute(
      {
        path: 'multiline.js',
        old_string: 'line two\nline three',
        new_string: 'replaced two\nreplaced three',
      },
      ctx,
    );
    assert.equal(result.ok, true);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('replaced two'));
    assert.ok(content.includes('replaced three'));
    assert.ok(!content.includes('line two'));
  });

  it('refuses the edit when expected_sha256 does not match', () => {
    const filePath = path.join(tmpDir, 'hash-guard.js');
    fs.writeFileSync(filePath, 'const value = 1;\n');
    const result = execute(
      {
        path: 'hash-guard.js',
        old_string: '1',
        new_string: '2',
        expected_sha256: 'bad-hash',
      },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Hash guard failed'));
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'const value = 1;\n');
  });

  it('allows the edit when expected_sha256 matches', () => {
    const filePath = path.join(tmpDir, 'hash-pass.js');
    const original = 'const value = 1;\n';
    fs.writeFileSync(filePath, original);
    const result = execute(
      {
        path: 'hash-pass.js',
        old_string: '1',
        new_string: '2',
        expected_sha256: sha256(original),
      },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'const value = 2;\n');
  });

  it('replace_all changes every occurrence', () => {
    const filePath = path.join(tmpDir, 'replace-all.js');
    fs.writeFileSync(filePath, 'hello\nhello\n');
    const result = execute(
      {
        path: 'replace-all.js',
        old_string: 'hello',
        new_string: 'bye',
        replace_all: true,
      },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'bye\nbye\n');
  });

  it('records undo metadata when ctx has a toolUseId', () => {
    const filePath = path.join(tmpDir, 'undo-meta.js');
    fs.writeFileSync(filePath, 'before\n');
    const undoCtx = { cwd: tmpDir, undoLog: [], toolUseId: 'tu-edit' };
    const result = execute(
      {
        path: 'undo-meta.js',
        old_string: 'before',
        new_string: 'after',
      },
      undoCtx,
    );
    assert.equal(result.ok, true);
    assert.equal(undoCtx.undoLog.length, 1);
    assert.equal(undoCtx.undoLog[0].tool_use_id, 'tu-edit');
    assert.equal(undoCtx.undoLog[0].path, 'undo-meta.js');
  });
});
