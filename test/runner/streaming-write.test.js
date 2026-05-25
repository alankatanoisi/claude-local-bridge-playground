'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { streamToFile } = require('../../src/runner/streaming-write');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stream-write-' + label + '-'));
}

async function* fromStrings(parts) {
  for (const p of parts) yield p;
}

describe('Ext-9 streaming-write', () => {
  it('writes chunks incrementally and reports sha256 + bytes', async () => {
    const cwd = tmp('ok');
    const target = path.join(cwd, 'out.txt');
    const parts = ['hello ', 'streaming ', 'world\n'];
    const r = await streamToFile(target, fromStrings(parts));
    assert.equal(fs.readFileSync(target, 'utf8'), 'hello streaming world\n');
    assert.equal(r.bytes, Buffer.byteLength('hello streaming world\n'));
    const expected = crypto.createHash('sha256').update('hello streaming world\n').digest('hex');
    assert.equal(r.sha256, expected);
    assert.equal(r.truncated, false);
  });

  it('truncates at hardCap and reports truncated:true', async () => {
    const cwd = tmp('cap');
    const target = path.join(cwd, 'capped.txt');
    const big = 'x'.repeat(2000);
    const r = await streamToFile(target, fromStrings([big, big, big]), { hardCap: 3500 });
    const written = fs.readFileSync(target, 'utf8');
    assert.equal(written.length, 3500);
    assert.equal(r.bytes, 3500);
    assert.equal(r.truncated, true);
  });

  it('creates parent directories as needed', async () => {
    const cwd = tmp('nested');
    const target = path.join(cwd, 'a/b/c/out.txt');
    await streamToFile(target, fromStrings(['nested']));
    assert.equal(fs.readFileSync(target, 'utf8'), 'nested');
  });

  it('writes atomically via tmp + rename', async () => {
    const cwd = tmp('atomic');
    const target = path.join(cwd, 'final.txt');
    fs.writeFileSync(target, 'OLD');
    await streamToFile(target, fromStrings(['NEW']));
    assert.equal(fs.readFileSync(target, 'utf8'), 'NEW');
    const entries = fs.readdirSync(cwd);
    assert.ok(!entries.some((e) => e.startsWith('final.txt.tmp')), 'no leftover tmp file');
  });

  it('cleans up the tmp file when the iterator throws', async () => {
    const cwd = tmp('error');
    const target = path.join(cwd, 'broken.txt');
    async function* failing() {
      yield 'partial';
      throw new Error('iterator boom');
    }
    await assert.rejects(streamToFile(target, failing()), /iterator boom/);
    const entries = fs.readdirSync(cwd);
    assert.equal(entries.length, 0, 'no files left behind');
  });
});
