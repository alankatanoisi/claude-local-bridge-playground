'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readIncludedFiles } = require('../../bin/local-bridge-runner');

describe('--include-file helper', () => {
  it('reads bounded project files into pasted context sections', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-file-'));
    fs.mkdirSync(path.join(tmpDir, 'src'));
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'console.log("hello");\n');

    const text = readIncludedFiles(tmpDir, ['src/app.js']);
    assert.ok(text.includes('Included file: src/app.js'));
    assert.ok(text.includes('console.log("hello")'));
  });

  it('rejects path escapes', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-file-escape-'));
    assert.throws(() => readIncludedFiles(tmpDir, ['../outside.txt']), /escapes cwd/);
  });

  it('rejects secret-looking files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-file-secret-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=1\n');
    assert.throws(() => readIncludedFiles(tmpDir, ['.env']), /blocked by safety rules/);
  });

  it('scrubs secrets from included file contents', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-file-redact-'));
    fs.writeFileSync(path.join(tmpDir, 'config.js'), 'const key = "sk-ant-' + 'a'.repeat(30) + '";\n');

    const text = readIncludedFiles(tmpDir, ['config.js']);
    assert.ok(text.includes('[REDACTED:anthropic_key]'));
    assert.ok(!text.includes('sk-ant-' + 'a'.repeat(30)));
  });
});
