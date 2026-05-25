'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildRepoMap, MAX_BYTES, SKIP_DIRS } = require('../../src/runner/repo-map');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repomap-' + label + '-'));
}

describe('Ext-5 repo map', () => {
  it('returns null for non-existent cwd', () => {
    assert.equal(buildRepoMap('/nonexistent-dir-xyz'), null);
    assert.equal(buildRepoMap(null), null);
  });

  it('lists top-level entries and entrypoints', () => {
    const cwd = tmp('basic');
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"x","version":"1.0.0"}');
    fs.writeFileSync(path.join(cwd, 'README.md'), '# project');
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'index.js'), 'console.log(1)');

    const map = buildRepoMap(cwd);
    assert.ok(map.includes('Top-level:'));
    assert.ok(map.includes('package.json'));
    assert.ok(map.includes('Entrypoint `package.json`'));
    assert.ok(map.includes('src/'));
    assert.ok(map.includes('File mix'));
  });

  it('respects MAX_BYTES cap', () => {
    const cwd = tmp('cap');
    const big = 'x'.repeat(10_000);
    fs.writeFileSync(path.join(cwd, 'package.json'), big);
    const map = buildRepoMap(cwd);
    assert.ok(map.length <= MAX_BYTES + 60, 'within cap (+ truncation marker)');
  });

  it('skips ignored directories', () => {
    const cwd = tmp('skip');
    fs.writeFileSync(path.join(cwd, 'a.js'), '1');
    fs.mkdirSync(path.join(cwd, 'node_modules'));
    fs.writeFileSync(path.join(cwd, 'node_modules', 'b.js'), 'pkg');
    assert.ok(SKIP_DIRS.has('node_modules'));
    const map = buildRepoMap(cwd);
    assert.ok(map.includes('.js=1'), 'only the top-level a.js counted');
  });

  it('returns null when nothing useful is present', () => {
    const cwd = tmp('empty');
    fs.mkdirSync(path.join(cwd, '.git'));
    const map = buildRepoMap(cwd);
    assert.equal(map, null);
  });
});
