'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execute } = require('../../src/runner/tools/list-files');

describe('list_files tool', () => {
  it('skips the local GitHub Actions runner install directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-files-'));
    fs.mkdirSync(path.join(tmpDir, 'actions-runner'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# demo\n');

    const result = execute({}, { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) });

    assert.equal(result.ok, true);
    assert.ok(result.text.includes('dir: src'));
    assert.ok(result.text.includes('file: README.md'));
    assert.ok(!result.text.includes('actions-runner'));
  });
});
