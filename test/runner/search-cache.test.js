'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const searchCache = require('../../src/runner/tools/_search-cache');

describe('E3 search-result cache', () => {
  beforeEach(() => {
    searchCache.clear();
  });

  it('hits on repeat get with the same key', () => {
    searchCache.set('needle', '/proj', { ok: true, text: 'src/a.js:1:needle' });
    const a = searchCache.get('needle', '/proj');
    const b = searchCache.get('needle', '/proj');
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.text, b.text);
    const s = searchCache.stats();
    assert.equal(s.hits, 2);
  });

  it('misses on different pattern or root', () => {
    searchCache.set('needle', '/proj', { ok: true, text: 'hit' });
    assert.equal(searchCache.get('needle', '/other'), null);
    assert.equal(searchCache.get('other', '/proj'), null);
  });

  it('invalidateForPath drops entries whose root is the path or an ancestor', () => {
    searchCache.set('a', '/proj/src', { ok: true, text: 'x' });
    searchCache.set('b', '/proj/src', { ok: true, text: 'y' });
    searchCache.set('c', '/other', { ok: true, text: 'z' });
    const dropped = searchCache.invalidateForPath('/proj/src/file.js');
    assert.equal(dropped, 2);
    assert.equal(searchCache.get('a', '/proj/src'), null);
    assert.equal(searchCache.get('c', '/other').text, 'z', 'unrelated root preserved');
  });

  it('invalidateForPath drops entries when the write is on a parent path', () => {
    searchCache.set('a', '/proj/src/sub', { ok: true, text: 'x' });
    const dropped = searchCache.invalidateForPath('/proj/src');
    assert.equal(dropped, 1);
    assert.equal(searchCache.get('a', '/proj/src/sub'), null);
  });

  it('integrates with search-text execute end-to-end', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-search-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'needle on line one\nother content\n');
    const searchText = require('../../src/runner/tools/search-text');
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const first = searchText.execute({ pattern: 'needle' }, ctx);
    assert.equal(first.ok, true);
    assert.ok(!first._fromCache);
    const second = searchText.execute({ pattern: 'needle' }, ctx);
    assert.equal(second.ok, true);
    assert.equal(second._fromCache, true);
    assert.equal(first.text, second.text);
  });
});
