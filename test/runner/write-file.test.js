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
});
