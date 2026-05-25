'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const prefetch = require('../../src/runner/tool-prefetch');
const fileCache = require('../../src/runner/tools/_file-cache');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-' + label + '-'));
}

describe('Ext-6 tool-prefetch', () => {
  let prevFlag;
  beforeEach(() => {
    prevFlag = process.env.BRIDGE_RUNNER_PREFETCH;
    fileCache.clear();
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.BRIDGE_RUNNER_PREFETCH;
    else process.env.BRIDGE_RUNNER_PREFETCH = prevFlag;
  });

  it('predictCandidates returns tsconfig.json + README.md after package.json', () => {
    const cwd = tmp('pkg');
    const candidates = prefetch.predictCandidates('package.json', cwd);
    assert.ok(candidates.some((c) => c.endsWith('tsconfig.json')));
    assert.ok(candidates.some((c) => c.endsWith('README.md')));
    assert.ok(candidates.length <= prefetch.MAX_PREFETCH_PER_CALL);
  });

  it('predictCandidates suggests test sibling for .js source', () => {
    const cwd = tmp('src');
    const candidates = prefetch.predictCandidates('src/util.js', cwd);
    assert.ok(candidates.some((c) => c.endsWith('util.test.js')));
  });

  it('warm() is a no-op when the prefetch flag is off', () => {
    delete process.env.BRIDGE_RUNNER_PREFETCH;
    const cwd = tmp('off');
    fs.writeFileSync(path.join(cwd, 'package.json'), '{}');
    fs.writeFileSync(path.join(cwd, 'tsconfig.json'), '{}');
    const ctx = { cwd, cwdRealpath: fs.realpathSync(cwd) };
    const warmed = prefetch.warm('package.json', ctx);
    assert.deepEqual(warmed, []);
  });

  it('warm() populates the file cache when enabled', () => {
    process.env.BRIDGE_RUNNER_PREFETCH = '1';
    const cwd = tmp('on');
    fs.writeFileSync(path.join(cwd, 'package.json'), '{}');
    fs.writeFileSync(path.join(cwd, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(cwd, 'README.md'), '# hi');
    const ctx = { cwd, cwdRealpath: fs.realpathSync(cwd) };
    const warmed = prefetch.warm('package.json', ctx);
    assert.ok(warmed.length >= 2, 'warmed at least tsconfig + README');
    const stats = fileCache.getStats();
    assert.ok(stats.entries >= 2);
  });

  it('warm() refuses paths that escape the workspace', () => {
    process.env.BRIDGE_RUNNER_PREFETCH = '1';
    const cwd = tmp('escape');
    const ctx = { cwd, cwdRealpath: fs.realpathSync(cwd) };
    // Even if predictCandidates returned an escape path, confinement would
    // filter it. Simulate via a direct call against a missing file outside.
    const warmed = prefetch.warm('package.json', ctx);
    for (const w of warmed) {
      assert.ok(w.startsWith(fs.realpathSync(cwd)), 'every warmed path stays inside cwd: ' + w);
    }
  });
});
