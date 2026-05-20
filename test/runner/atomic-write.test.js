'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { atomicWriteFile } = require('../../src/runner/tools/file-write-utils');

describe('atomic write helper', () => {
  it('writes content and does not leave temp files behind', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
    const filePath = path.join(tmpDir, 'file.txt');
    atomicWriteFile(filePath, 'hello');
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'hello');
    const leftovers = fs.readdirSync(tmpDir).filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  });

  it('creates parent directories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-dir-'));
    const filePath = path.join(tmpDir, 'a', 'b', 'file.txt');
    atomicWriteFile(filePath, 'nested');
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'nested');
  });
});
