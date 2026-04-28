#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const readmePath = path.join(root, 'README.md');
const quickstartPath = path.join(root, 'QUICKSTART.md');

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const config = pkg?.contributes?.configuration?.properties || {};

const defaults = {
  port: config['claudeLocalBridge.port']?.default,
  defaultModel: config['claudeLocalBridge.defaultModel']?.default,
  requireCallerAuth: config['claudeLocalBridge.requireCallerAuth']?.default,
};

const docs = [
  { name: 'README.md', path: readmePath, text: fs.readFileSync(readmePath, 'utf8') },
  {
    name: 'QUICKSTART.md',
    path: quickstartPath,
    text: fs.readFileSync(quickstartPath, 'utf8'),
  },
];

const errors = [];

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function has(text, pattern) {
  return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
}

assert(Number.isInteger(defaults.port), 'package.json missing numeric default for claudeLocalBridge.port');
assert(typeof defaults.defaultModel === 'string', 'package.json missing string default for claudeLocalBridge.defaultModel');
assert(
  typeof defaults.requireCallerAuth === 'boolean',
  'package.json missing boolean default for claudeLocalBridge.requireCallerAuth',
);

for (const doc of docs) {
  assert(
    has(doc.text, `localhost:${defaults.port}`),
    `${doc.name} does not mention localhost:${defaults.port}`,
  );

  assert(
    !has(doc.text, /localhost:11436/),
    `${doc.name} still contains old localhost:11436 default`,
  );
}

const readme = docs.find((d) => d.name === 'README.md').text;
const quickstart = docs.find((d) => d.name === 'QUICKSTART.md').text;

assert(
  has(readme, defaults.defaultModel),
  `README.md does not mention default model ${defaults.defaultModel}`,
);

assert(
  has(readme, `ANTHROPIC_BASE_URL=http://localhost:${defaults.port}`),
  'README.md is missing Claude CLI base URL example without /v1',
);

assert(
  has(quickstart, `ANTHROPIC_BASE_URL=http://localhost:${defaults.port}`),
  'QUICKSTART.md is missing Claude CLI base URL example without /v1',
);

assert(
  has(readme, `http://localhost:${defaults.port}/v1`),
  'README.md is missing OpenAI-compatible /v1 base URL guidance',
);

assert(
  has(quickstart, `http://localhost:${defaults.port}/v1`),
  'QUICKSTART.md is missing OpenAI-compatible /v1 base URL guidance',
);

if (defaults.requireCallerAuth) {
  assert(
    has(readme, 'Authorization: Bearer'),
    'README.md is missing caller Authorization Bearer guidance',
  );
  assert(
    has(quickstart, 'Authorization: Bearer'),
    'QUICKSTART.md is missing caller Authorization Bearer guidance',
  );
}

if (errors.length) {
  console.error('Documentation defaults check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Documentation defaults check passed.');
console.log(`- port: ${defaults.port}`);
console.log(`- defaultModel: ${defaults.defaultModel}`);
console.log(`- requireCallerAuth: ${defaults.requireCallerAuth}`);
