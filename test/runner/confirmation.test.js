'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { ask, askToolFailureRecovery, parseToolFailureRecoveryChoice } = require('../../src/runner/confirmation');

describe('runner confirmation', () => {
  it('parses the documented recovery choices and uses continue as the foreground default', () => {
    assert.equal(parseToolFailureRecoveryChoice(''), 'continue');
    assert.equal(parseToolFailureRecoveryChoice('1'), 'continue');
    assert.equal(parseToolFailureRecoveryChoice('guidance'), 'guide');
    assert.equal(parseToolFailureRecoveryChoice('3'), 'stop');
    assert.equal(parseToolFailureRecoveryChoice('surprise'), null);
  });

  it('denies approval when no interactive terminal is available', async () => {
    const originalOpenSync = fs.openSync;
    const originalError = console.error;
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const errors = [];

    fs.openSync = () => {
      throw new Error('no tty');
    };
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    console.error = (...parts) => errors.push(parts.join(' '));

    try {
      const choice = await ask('Write README.md');
      assert.equal(choice, 'deny');
      assert.ok(errors.some((line) => line.includes('no interactive terminal')));
    } finally {
      fs.openSync = originalOpenSync;
      console.error = originalError;
      if (stdinTtyDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinTtyDescriptor);
      else delete process.stdin.isTTY;
    }
  });

  it('stops safely when repeated failures occur without an interactive terminal', async () => {
    const originalOpenSync = fs.openSync;
    const originalError = console.error;
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    fs.openSync = () => {
      throw new Error('no tty');
    };
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    console.error = () => {};

    try {
      const decision = await askToolFailureRecovery({
        failures: 3,
        failureSummary: [{ tool: 'read_file', message: 'missing' }],
      });
      assert.deepEqual(decision, { action: 'stop', reason: 'non_interactive' });
    } finally {
      fs.openSync = originalOpenSync;
      console.error = originalError;
      if (stdinTtyDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinTtyDescriptor);
      else delete process.stdin.isTTY;
    }
  });
});
