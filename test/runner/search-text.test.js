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
});
