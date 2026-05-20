'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { execute } = require('../../src/runner/tools/bash');

describe('bash tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-'));
  fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');

  it('runs a simple command and returns output', () => {
    const result = execute({ command: 'cat test.txt' }, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('hello'));
  });

  it('returns error for non-zero exit', () => {
    const result = execute({ command: 'cat nonexistent.txt' }, { cwd: tmpDir });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('exited with code'));
  });

  it('handles empty output gracefully', () => {
    const result = execute({ command: 'true' }, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('no output'));
  });

  it('runs in the correct working directory', () => {
    const subdir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, 'subfile.txt'), 'subcontent');
    const result = execute({ command: 'cat subfile.txt' }, { cwd: subdir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('subcontent'));
  });

  it('truncates long output', () => {
    // Generate enough output to exceed MAX_OUTPUT_CHARS (10000)
    const result = execute({ command: 'yes head | head -10000' }, { cwd: tmpDir, shellTimeout: 10000 });
    assert.equal(result.ok, true);
  });

  it('times out on slow commands', () => {
    const result = execute({ command: 'sleep 10' }, { cwd: tmpDir, shellTimeout: 500 });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('timed out'));
  });
});
