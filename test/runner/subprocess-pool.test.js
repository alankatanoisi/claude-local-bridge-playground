'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../src/runner/subprocess-pool');

describe('Ext-7 subprocess pool', () => {
  beforeEach(() => {
    pool.releaseAll();
    pool.unregisterFactory('test-binary');
  });
  afterEach(() => {
    pool.releaseAll();
    pool.unregisterFactory('test-binary');
  });

  it('returns null when no factory is registered', () => {
    const m = pool.acquire({ binary: 'unknown-bin', cwd: '/tmp', env: {} });
    assert.equal(m, null);
  });

  it('factory runs once per (binary, cwd, env) tuple', () => {
    let spawns = 0;
    pool.registerFactory('test-binary', () => {
      spawns++;
      return { run: () => 'ok', dispose: () => {} };
    });
    const a = pool.acquire({ binary: 'test-binary', cwd: '/proj', env: { A: '1' } });
    const b = pool.acquire({ binary: 'test-binary', cwd: '/proj', env: { A: '1' } });
    assert.equal(a, b);
    assert.equal(spawns, 1);
  });

  it('different cwd or env produces a fresh slot', () => {
    let spawns = 0;
    pool.registerFactory('test-binary', () => {
      spawns++;
      return { run: () => 'ok', dispose: () => {} };
    });
    pool.acquire({ binary: 'test-binary', cwd: '/a', env: {} });
    pool.acquire({ binary: 'test-binary', cwd: '/b', env: {} });
    pool.acquire({ binary: 'test-binary', cwd: '/a', env: { X: '1' } });
    assert.equal(spawns, 3);
  });

  it('releaseAll disposes every member and empties the registry of slots', () => {
    let disposed = 0;
    pool.registerFactory('test-binary', () => ({
      run: () => 'ok',
      dispose: () => {
        disposed++;
      },
    }));
    pool.acquire({ binary: 'test-binary', cwd: '/a', env: {} });
    pool.acquire({ binary: 'test-binary', cwd: '/b', env: {} });
    assert.equal(pool.stats().slots, 2);
    pool.releaseAll();
    assert.equal(disposed, 2);
    assert.equal(pool.stats().slots, 0);
  });
});
