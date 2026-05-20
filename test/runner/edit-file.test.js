'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Test the edit_file tool directly (bypassing permission check)
const { execute } = require('../../src/runner/tools/edit-file');

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
});
