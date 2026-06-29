'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execute } = require('../../src/runner/tools/glob');

describe('glob tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-tool-'));
  const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };

  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(srcDir);
  fs.writeFileSync(path.join(srcDir, 'alpha.test.js'), 'a');
  fs.writeFileSync(path.join(srcDir, 'beta.js'), 'b');
  fs.writeFileSync(path.join(tmpDir, 'readme.md'), 'c');

  it('finds files matching **/*.js', () => {
    const result = execute({ pattern: '**/*.js' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('src/beta.js'));
    assert.ok(result.text.includes('src/alpha.test.js'));
  });

  it('finds files matching **/*.test.js', () => {
    const result = execute({ pattern: '**/*.test.js' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('src/alpha.test.js'));
    assert.ok(!result.text.includes('beta.js'));
  });

  it('scopes search to a subdirectory', () => {
    const result = execute({ pattern: '**/*.js', path: 'src' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('src/beta.js'));
    assert.ok(!result.text.includes('readme.md'));
  });

  it('returns a friendly message when nothing matches', () => {
    const result = execute({ pattern: '**/*.xyz' }, ctx);
    assert.equal(result.ok, true);
    assert.match(result.text, /No files matched/);
  });

  it('rejects path escape', () => {
    const result = execute({ pattern: '*.md', path: '../' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /escapes working directory/);
  });

  it('skips the local GitHub Actions runner install directory', () => {
    const runnerDir = path.join(tmpDir, 'actions-runner');
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.writeFileSync(path.join(runnerDir, 'secret-log.txt'), 'runner internals');

    const result = execute({ pattern: '**/*.txt' }, ctx);

    assert.equal(result.ok, true);
    assert.ok(!result.text.includes('actions-runner'));
  });

  it('requires pattern', () => {
    const result = execute({}, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /Missing pattern/);
  });
});
