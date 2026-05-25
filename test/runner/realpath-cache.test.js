'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const safety = require('../../src/runner/safety');

describe('D2 realpath cache', () => {
  it('caches realpath per session ctx', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-cache-'));
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const a = safety.cachedRealpathSync(ctx, tmp);
    const b = safety.cachedRealpathSync(ctx, tmp);
    assert.equal(a, b);
    assert.equal(a, ctx.cwdRealpath);
  });

  it('confinePath populates the cache transparently', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-confine-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const resolved1 = safety.confinePath(ctx, 'a.txt');
    assert.ok(resolved1);
    let calls = 0;
    const realFn = fs.realpathSync;
    fs.realpathSync = function (p) {
      calls++;
      return realFn.call(fs, p);
    };
    try {
      safety.confinePath(ctx, 'a.txt');
    } finally {
      fs.realpathSync = realFn;
    }
    assert.equal(calls, 0, 'second confinePath served entirely from cache');
  });

  it('invalidateRealpathCache(ctx, paths) drops specific entries', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-invalidate-'));
    const filePath = path.join(tmp, 'file.txt');
    fs.writeFileSync(filePath, 'orig');
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    safety.confinePath(ctx, 'file.txt');
    safety.invalidateRealpathCache(ctx, ['file.txt']);
    let calls = 0;
    const realFn = fs.realpathSync;
    fs.realpathSync = function (p) {
      calls++;
      return realFn.call(fs, p);
    };
    try {
      safety.confinePath(ctx, 'file.txt');
    } finally {
      fs.realpathSync = realFn;
    }
    assert.ok(calls >= 1, 'invalidated entry causes a fresh realpath call');
  });

  it('different ctx objects do not share cache', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-isolation-'));
    const ctxA = { cwd: tmp };
    const ctxB = { cwd: tmp };
    safety.cachedRealpathSync(ctxA, tmp);
    let calls = 0;
    const realFn = fs.realpathSync;
    fs.realpathSync = function (p) {
      calls++;
      return realFn.call(fs, p);
    };
    try {
      safety.cachedRealpathSync(ctxB, tmp);
    } finally {
      fs.realpathSync = realFn;
    }
    assert.equal(calls, 1, 'second ctx miss triggered a real call');
  });
});
