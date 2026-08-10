'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { discoverRepositoryDocuments } = require('../src/repo-manifest');

test('repository discovery is bounded, deterministic, and excludes secret paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-fanout-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'module.exports = 2;\n');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'src', '.env'), 'TOKEN=do-not-read\n');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'ignored\n');

  const documents = discoverRepositoryDocuments({
    root,
    includeRoots: ['src'],
    extensions: ['.js'],
    maxFiles: 1,
    maxFileBytes: 1000,
    maxTotalBytes: 1000,
  });

  assert.equal(documents.length, 1);
  assert.equal(documents[0].relativePath, path.join('src', 'a.js'));
  assert.equal(documents[0].kind, 'repo_file');
  assert.equal(documents[0].metadata.language, 'javascript');
  assert.doesNotMatch(documents[0].text, /do-not-read/);
});

test('repository discovery rejects include roots outside the target', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-boundary-'));
  assert.throws(
    () => discoverRepositoryDocuments({ root, includeRoots: ['../outside'] }),
    /escapes repository root/,
  );
});
