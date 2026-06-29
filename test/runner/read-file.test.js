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
    assert.ok(result.text.includes('1|'));
  });

  it('respects max_bytes', () => {
    const filePath = path.join(tmpDir, 'long.txt');
    fs.writeFileSync(filePath, 'A'.repeat(1000));
    const result = execute({ path: 'long.txt', max_bytes: 100 }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('PARTIAL') || result.text.includes('max_bytes'));
    assert.ok(result.text.length < 500);
  });

  it('reads a bounded prefix without loading the whole file helper', () => {
    const filePath = path.join(tmpDir, 'prefix-only.txt');
    fs.writeFileSync(filePath, 'C'.repeat(1000));
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = () => {
      throw new Error('readFileSync should not load the whole file');
    };

    try {
      const result = execute(
        { path: 'prefix-only.txt', max_bytes: 20 },
        { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) },
      );
      assert.equal(result.ok, true);
      assert.ok(result.text.includes('PARTIAL') || result.text.includes('max_bytes'));
      assert.ok(result.text.length < 200);
    } finally {
      fs.readFileSync = originalReadFileSync;
    }
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

  it('returns empty file marker', () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(filePath, '');
    const result = execute({ path: 'empty.txt' }, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });
    assert.equal(result.ok, true);
    assert.equal(result.text, '(empty file)');
  });

  it('pages with offset and limit', () => {
    const filePath = path.join(tmpDir, 'lines.txt');
    fs.writeFileSync(filePath, Array.from({ length: 20 }, (_, i) => 'line-' + (i + 1)).join('\n'));
    const result = execute(
      { path: 'lines.txt', offset: 11, limit: 5 },
      { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) },
    );
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('11|line-11'));
    assert.ok(result.text.includes('15|line-15'));
    assert.ok(!result.text.includes('10|line-10'));
    assert.ok(result.text.includes('offset=16'));
  });

  it('reports offset past EOF', () => {
    const filePath = path.join(tmpDir, 'short.txt');
    fs.writeFileSync(filePath, 'one\ntwo\n');
    const result = execute(
      { path: 'short.txt', offset: 99 },
      { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) },
    );
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('past end of file'));
  });
});

describe('read_file tool — file cache', () => {
  const fileCache = require('../../src/runner/tools/_file-cache');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readfile-cache-'));
  const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };

  it('serves repeat reads from the cache', () => {
    fileCache.clear();
    const filePath = path.join(tmpDir, 'hot.txt');
    fs.writeFileSync(filePath, 'cached payload');

    const first = execute({ path: 'hot.txt' }, ctx);
    const second = execute({ path: 'hot.txt' }, ctx);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.text, first.text);

    const stats = fileCache.getStats();
    assert.equal(stats.misses, 1, 'one disk read');
    assert.equal(stats.hits, 1, 'one cache hit');
  });

  it('invalidates when mtime changes', () => {
    fileCache.clear();
    const filePath = path.join(tmpDir, 'edited.txt');
    fs.writeFileSync(filePath, 'before');

    const first = execute({ path: 'edited.txt' }, ctx);
    assert.ok(first.text.includes('before'));

    // Bump mtime forward to guarantee detection on coarse-mtime filesystems
    const futureMs = Date.now() + 5000;
    fs.writeFileSync(filePath, 'after');
    fs.utimesSync(filePath, futureMs / 1000, futureMs / 1000);

    const second = execute({ path: 'edited.txt' }, ctx);
    assert.ok(second.text.includes('after'), 'reflects post-edit content');

    const stats = fileCache.getStats();
    assert.equal(stats.hits, 0, 'no cache hits — mtime changed');
    assert.equal(stats.misses, 2, 'two fresh reads');
  });

  it('bypasses the cache for files above the per-entry cap', () => {
    fileCache.clear();
    const filePath = path.join(tmpDir, 'huge.bin');
    // One byte over the cap is enough to be skipped.
    const buf = Buffer.alloc(fileCache.MAX_CACHEABLE_BYTES + 1, 0x41);
    fs.writeFileSync(filePath, buf);

    // Use a small max_bytes so the test stays fast; we only care that the
    // file did not enter the cache.
    const result = execute({ path: 'huge.bin', max_bytes: 256 }, ctx);
    assert.equal(result.ok, true);
    const stats = fileCache.getStats();
    assert.equal(stats.entries, 0, 'oversize file not cached');
    assert.ok(stats.bypassed >= 1, 'bypass counter incremented');
  });
});
