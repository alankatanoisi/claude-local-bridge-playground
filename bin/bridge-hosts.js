#!/usr/bin/env node
'use strict';

// This command manages only the three jobs installed by this project.
// It never terminates the user's ordinary editor or guesses ownership by port.
const path = require('path');
const control = require('../src/hosting/control');
const [command, mode, ...extras] = process.argv.slice(2);
async function main() {
  if (extras.some((arg) => arg !== '--no-open')) throw new Error('Unexpected argument');
  if (command === 'status') return control.status();
  if (command === 'test') return control.smokeTest(mode);
  await control.withLock(async () => {
    if (command === 'install') return control.install(path.resolve(__dirname, '..'));
    if (command === 'start') return control.start(mode, { open: !extras.includes('--no-open') });
    if (command === 'stop') return mode === 'all' ? control.stopAll() : control.stop(mode);
    throw new Error('Usage: bridge-hosts install | start MODE [--no-open] | stop MODE|all | status | test MODE');
  });
}
main().catch((error) => {
  // Subprocess errors sometimes include captured output. Do not print it:
  // a private application log is the right place to inspect those details.
  console.error(
    error.status !== undefined
      ? 'A local application command failed. Inspect the dedicated private logs.'
      : error.message,
  );
  process.exitCode = 1;
});
