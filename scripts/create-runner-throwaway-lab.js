#!/usr/bin/env node
'use strict';

/**
 * Create a fresh, disposable project for runner smoke tests.
 *
 * This intentionally creates a brand-new timestamped folder instead of reusing
 * an old lab directory. Reusing a folder can accidentally mix a tiny test app
 * with a copied real repo, which makes the runner's job much noisier.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function stamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function write(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function createThrowawayLab(options = {}) {
  const baseDir = options.baseDir || path.join(os.homedir(), 'Documents', 'claude-local-bridge-runner-throwaway-labs');
  const labDir = path.join(baseDir, 'lab-' + stamp(options.now));

  fs.mkdirSync(labDir, { recursive: false });
  fs.mkdirSync(path.join(labDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(labDir, 'test'), { recursive: true });

  write(
    path.join(labDir, 'package.json'),
    JSON.stringify(
      {
        name: 'runner-throwaway-lab',
        type: 'commonjs',
        scripts: {
          test: 'node test/calc.test.js',
        },
      },
      null,
      2,
    ) + '\n',
  );

  write(
    path.join(labDir, 'src', 'calc.js'),
    `function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a + b;
}

module.exports = { add, multiply };
`,
  );

  write(
    path.join(labDir, 'test', 'calc.test.js'),
    `const assert = require('assert');
const { add, multiply } = require('../src/calc');

assert.equal(add(2, 3), 5);
assert.equal(multiply(4, 5), 20);

console.log('tests passed');
`,
  );

  write(
    path.join(labDir, 'README.md'),
    `# Runner Throwaway Lab

This is a disposable project for testing the local bridge runner.
`,
  );

  return labDir;
}

if (require.main === module) {
  const labDir = createThrowawayLab();
  console.log(labDir);
}

module.exports = { createThrowawayLab, stamp };
