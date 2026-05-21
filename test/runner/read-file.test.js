'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execute } = require('../../src/runner/tools/read-file');

describe('read_file tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readfile-'));

  it('reads a normal file', () => {
    const filePath = path.join(tmpDir, 'hello.txt');
    fs.writeFileSync(filePath, 'Hello, world!');
    const result = execute({ path: 'hello.txt' }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('Hello, world!'));
  });

  it('respects max_bytes', () => {
    const filePath = path.join(tmpDir, 'long.txt');
    fs.writeFileSync(filePath, 'A'.repeat(1000));
    const result = execute({ path: 'long.txt', max_bytes: 100 }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('truncated'));
    // Text should be much shorter than 1000 chars (the original file)
    assert.ok(result.text.length < 500);
  });

  it('enforces hard cap even when max_bytes exceeds it', () => {
    const filePath = path.join(tmpDir, 'huge.txt');
    fs.writeFileSync(filePath, 'B'.repeat(2000));
    // Request 2MB — should be capped to 1MB hard limit
    const result = execute(
      { path: 'huge.txt', max_bytes: 2000000 },
      { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) },
    );
    assert.equal(result.ok, true);
    // Should NOT get 2MB of data — capped at 1MB hard limit
    assert.ok(result.text.length < 2000000);
  });

  it('returns error for missing file', () => {
    const result = execute({ path: 'nonexistent.txt' }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Error'));
  });

  it('returns error for missing path argument', () => {
    const result = execute({}, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Missing'));
  });
});
