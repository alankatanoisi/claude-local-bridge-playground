#!/usr/bin/env node
'use strict';

// This entry point runs the real bridge without loading VS Code or a test mock.
const { startStandalone, parseArguments } = require('../src/standalone');
startStandalone(parseArguments(process.argv.slice(2))).catch((error) => {
  // Error messages here concern local configuration, not credential contents.
  console.error(`Standalone bridge could not start: ${error.message}`);
  process.exitCode = 1;
});
