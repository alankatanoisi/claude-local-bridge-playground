'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execute } = require('../../src/runner/tools/search-text');

describe('search_text tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
  const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };

  it('finds text in a file', () => {
    fs.writeFileSync(path.join(tmpDir, 'findme.txt'), 'hello world\nfindme is here\n');
    const result = execute({ pattern: 'findme' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('findme'));
  });

  it('searches inside one requested file path', () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'one.js'), 'const targetNeedle = true;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'two.js'), 'const targetNeedle = false;\n');

    // The model often narrows search to one file after a broad search result.
    // This should search src/one.js itself, not try to use that file as cwd.
    const result = execute({ pattern: 'targetNeedle', path: 'src/one.js' }, ctx);

    assert.equal(result.ok, true);
    assert.ok(result.text.includes('one.js') || result.text.includes('1:const targetNeedle'));
    assert.ok(!result.text.includes('two.js'));

    const second = execute({ pattern: 'targetNeedle', path: 'src/two.js' }, ctx);
    assert.equal(second.ok, true);
    assert.ok(second.text.includes('two.js') || second.text.includes('1:const targetNeedle'));
    assert.ok(!second.text.includes('one.js'));
  });

  it('returns no matches for missing pattern', () => {
    fs.writeFileSync(path.join(tmpDir, 'nomatch.txt'), 'nothing relevant here\n');
    const result = execute({ pattern: 'zzz_absolutely_nonexistent_xyz_98765' }, ctx);
    assert.equal(result.ok, true);
    // Either "No matches found" or empty result is fine
    assert.ok(!result.text.includes('zzz_absolutely_nonexistent_xyz_98765'));
  });

  it('handles special regex characters safely', () => {
    fs.writeFileSync(path.join(tmpDir, 'special.txt'), 'file with ; echo pwned\n');
    const result = execute({ pattern: '; echo' }, ctx);
    // Should not crash even with shell metacharacters in the pattern
    assert.equal(result.ok, true);
  });

  it('skips the local GitHub Actions runner install directory', () => {
    const runnerDir = path.join(tmpDir, 'actions-runner');
    fs.mkdirSync(runnerDir, { recursive: true });
    fs.writeFileSync(path.join(runnerDir, 'runner-secret.txt'), 'do-not-search-this-text\n');

    const result = execute({ pattern: 'do-not-search-this-text' }, ctx);

    assert.equal(result.ok, true);
    assert.ok(!result.text.includes('actions-runner'));
    assert.ok(!result.text.includes('do-not-search-this-text'));
  });

  it('does not return matches from deny-matrix files such as .env', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SEARCH_DENY_SECRET=super-secret-value\n');
    fs.writeFileSync(path.join(tmpDir, 'safe.txt'), 'SEARCH_DENY_SECRET should appear only here\n');

    const result = execute({ pattern: 'SEARCH_DENY_SECRET' }, ctx);

    assert.equal(result.ok, true);
    assert.ok(result.text.includes('safe.txt'), 'ordinary files remain searchable');
    assert.ok(!result.text.includes('.env'), 'deny-matrix path must not appear');
    assert.ok(!result.text.includes('super-secret-value'), 'secret value must not leak via search');
  });

  it('refuses a direct search path that points at a deny-matrix file', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'DIRECT_ENV_SECRET=nope\n');
    const result = execute({ pattern: 'DIRECT_ENV_SECRET', path: '.env' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /Blocked file type|potential secret/i);
    assert.ok(!result.text.includes('nope'));
  });

  it('does not follow a project symlink to a file outside --cwd', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-outside-'));
    const outsideFile = path.join(outsideDir, 'outside-secret.txt');
    fs.writeFileSync(outsideFile, 'SYMLINK_ESCAPE_NEEDLE=outside\n');
    const linkPath = path.join(tmpDir, 'alias-outside.txt');
    fs.symlinkSync(outsideFile, linkPath);

    const result = execute({ pattern: 'SYMLINK_ESCAPE_NEEDLE' }, ctx);

    assert.equal(result.ok, true);
    assert.ok(!result.text.includes('SYMLINK_ESCAPE_NEEDLE'));
    assert.ok(!result.text.includes('outside-secret'));
  });
});
