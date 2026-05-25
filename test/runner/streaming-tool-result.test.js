'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const safety = require('../../src/runner/safety');
const readFile = require('../../src/runner/tools/read-file');

describe('B4 streaming scrubber', () => {
  it('passes through non-secret content unchanged', () => {
    const s = safety.makeStreamingScrubber();
    let out = '';
    out += s.push('hello world '.repeat(1000));
    out += s.end();
    assert.match(out, /^hello world /);
    assert.ok(!out.includes('[REDACTED'));
  });

  it('redacts a secret split across chunk boundaries', () => {
    const s = safety.makeStreamingScrubber();
    const fakeKey = 'sk-ant-' + 'a'.repeat(95);
    const padded = 'lorem '.repeat(5000) + 'token: ' + fakeKey + ' end';
    const half = Math.floor(padded.length / 2);
    let out = '';
    out += s.push(padded.slice(0, half));
    out += s.push(padded.slice(half));
    out += s.end();
    assert.ok(!out.includes(fakeKey), 'secret should be redacted even when split across chunks');
  });

  it('end() flushes the remaining buffer', () => {
    const s = safety.makeStreamingScrubber();
    s.push('a'.repeat(100));
    const tail = s.end();
    assert.equal(tail.length, 100);
  });
});

describe('B4 read_file streaming path', () => {
  it('returns isStreaming for cold-cache reads above the threshold', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-read-'));
    const big = path.join(tmp, 'big.txt');
    // Larger than _file-cache's MAX_CACHEABLE_BYTES (1MB) so it bypasses the
    // cache and lands on the streaming branch.
    fs.writeFileSync(big, 'x'.repeat(1_500_000));
    const ctx = { cwd: tmp };
    const result = readFile.execute({ path: 'big.txt', max_bytes: 1_000_000, max_lines: 100_000 }, ctx);
    assert.equal(result.ok, true);
    assert.equal(result.isStreaming, true);
    assert.ok(typeof result.stream[Symbol.asyncIterator] === 'function', 'stream is async iterable');
    let total = 0;
    for await (const chunk of result.stream) total += chunk.length;
    assert.ok(total >= 999_000, 'streamed at least most of the byte cap');
  });

  it('stays on the buffered path for small files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b4-small-'));
    const small = path.join(tmp, 'small.txt');
    fs.writeFileSync(small, 'hello');
    const ctx = { cwd: tmp };
    const result = readFile.execute({ path: 'small.txt' }, ctx);
    assert.equal(result.ok, true);
    assert.equal(result.isStreaming, undefined);
    assert.match(result.text, /hello/);
  });
});
