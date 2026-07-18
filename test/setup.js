'use strict';

// Load the VS Code mock before any test files
require('./__mocks__/vscode');
process.env.BRIDGE_RUNNER_TEST = '1';
process.env.BRIDGE_RUNNER_ARCHIVE = '0';

// P0-08: trust bypass is injected here for the test harness instead of treating
// BRIDGE_RUNNER_TEST as a production escape hatch inside run()/CLI.
const runModule = require('../src/runner/run');
const originalRun = runModule.run;
runModule.run = function runWithTestTrustDefault(options = {}) {
  if (options.skipTrustGate === undefined) {
    return originalRun({ ...options, skipTrustGate: true });
  }
  return originalRun(options);
};
