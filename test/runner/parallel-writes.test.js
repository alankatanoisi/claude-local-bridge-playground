'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { _arePathsDisjoint, _groupDisjointWrites } = require('../../src/runner/run');

describe('B3 path-disjoint grouping', () => {
  it('treats identical paths as not disjoint', () => {
    assert.equal(_arePathsDisjoint(['/x/a', '/x/a']), false);
  });

  it('treats parent/child as not disjoint', () => {
    assert.equal(_arePathsDisjoint(['/x/dir', '/x/dir/file.txt']), false);
    assert.equal(_arePathsDisjoint(['/x/dir/file.txt', '/x/dir']), false);
  });

  it('treats sibling files as disjoint', () => {
    assert.equal(_arePathsDisjoint(['/x/a.txt', '/x/b.txt']), true);
    assert.equal(_arePathsDisjoint(['/x/a.txt', '/x/b.txt', '/x/c.txt']), true);
  });

  it('rejects empty / falsy paths in a set', () => {
    assert.equal(_arePathsDisjoint(['/x/a', null]), false);
    assert.equal(_arePathsDisjoint([undefined, '/x/a']), false);
  });

  it('groups consecutive disjoint writes into one group', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-group-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), '');
    fs.writeFileSync(path.join(tmp, 'b.txt'), '');
    fs.writeFileSync(path.join(tmp, 'c.txt'), '');
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const writeTools = [
      { id: '1', name: 'write_file', input: { path: 'a.txt' } },
      { id: '2', name: 'write_file', input: { path: 'b.txt' } },
      { id: '3', name: 'edit_file', input: { path: 'c.txt' } },
    ];
    const groups = _groupDisjointWrites(writeTools, ctx);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].length, 3);
  });

  it('breaks the group when a path conflicts with the prior group', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-conflict-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), '');
    fs.writeFileSync(path.join(tmp, 'b.txt'), '');
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const writeTools = [
      { id: '1', name: 'write_file', input: { path: 'a.txt' } },
      { id: '2', name: 'edit_file', input: { path: 'a.txt' } },
      { id: '3', name: 'write_file', input: { path: 'b.txt' } },
    ];
    const groups = _groupDisjointWrites(writeTools, ctx);
    assert.equal(groups.length, 2, 'two groups: [1], [2,3]');
    assert.deepEqual(
      groups.map((g) => g.map((t) => t.id)),
      [['1'], ['2', '3']],
    );
  });

  // A10: grouping used to canonicalize with confinePath, which returns the
  // LEXICAL path. Two names for one file therefore produced two different
  // strings, looked disjoint, and were written in parallel to the same inode.
  // resolveFileTarget keys on the realpath, so the aliases now collide.
  it('does not treat a symlink and its target as disjoint', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-alias-'));
    fs.writeFileSync(path.join(tmp, 'real.txt'), '');
    fs.symlinkSync(path.join(tmp, 'real.txt'), path.join(tmp, 'alias.txt'));
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const writeTools = [
      { id: '1', name: 'write_file', input: { path: 'real.txt' } },
      { id: '2', name: 'edit_file', input: { path: 'alias.txt' } },
    ];
    const groups = _groupDisjointWrites(writeTools, ctx);
    assert.equal(groups.length, 2, 'aliases of one file must not share a parallel group');
    assert.deepEqual(
      groups.map((g) => g.map((t) => t.id)),
      [['1'], ['2']],
    );
  });

  it('still groups genuinely distinct files when a symlink is present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-alias-ok-'));
    fs.writeFileSync(path.join(tmp, 'real.txt'), '');
    fs.writeFileSync(path.join(tmp, 'other.txt'), '');
    fs.symlinkSync(path.join(tmp, 'other.txt'), path.join(tmp, 'alias.txt'));
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const writeTools = [
      { id: '1', name: 'write_file', input: { path: 'real.txt' } },
      { id: '2', name: 'edit_file', input: { path: 'alias.txt' } },
    ];
    const groups = _groupDisjointWrites(writeTools, ctx);
    assert.equal(groups.length, 1, 'alias resolving to a different inode is still disjoint');
    assert.equal(groups[0].length, 2);
  });

  it('isolates tools without a `path` argument (e.g. bash)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-bash-'));
    const ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
    const writeTools = [
      { id: '1', name: 'bash', input: { command: 'echo hi' } },
      { id: '2', name: 'write_file', input: { path: 'a.txt' } },
    ];
    const groups = _groupDisjointWrites(writeTools, ctx);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].length, 1);
    assert.equal(groups[0][0].id, '1');
  });
});
