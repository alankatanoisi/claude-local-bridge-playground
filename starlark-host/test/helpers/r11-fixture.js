'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadExperimentConfig } = require('../../src/config');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-r11-'));
  const inputRoot = path.join(root, 'input');
  fs.mkdirSync(inputRoot);
  const documents = Array.from({ length: 6 }, (_, index) => {
    const id = `doc${index + 1}`;
    const text = `// fixture ${id}\nmodule.exports = ${index};\n`;
    fs.writeFileSync(path.join(inputRoot, `${id}.js`), text);
    return {
      id,
      relativePath: `${id}.js`,
      text,
      bytes: Buffer.byteLength(text),
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      kind: 'repo_file',
    };
  });
  const config = {
    ...loadExperimentConfig(),
    targetRoot: inputRoot,
    maxConcurrency: 3,
    maxJobsPerPhase: 6,
    traceLevel: 'off',
    synthesis: { strategy: 'single' },
  };
  config.workflows = {
    repo_fanout: {
      worker: 'repo_file_analyst',
      objective: 'Profile the fixtures.',
      input: {
        type: 'repository',
        includeRoots: ['.'],
        extensions: ['.js'],
        maxFiles: 6,
        maxFileBytes: 1000,
        maxTotalBytes: 6000,
      },
    },
  };
  const fixturePath = path.join(root, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify({ root, config }));
  return { root, config, documents, fixturePath, runDir: path.join(root, 'run') };
}

module.exports = { fixture };
