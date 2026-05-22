'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { ask } = require('../../src/runner/confirmation');

describe('runner confirmation', () => {
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
});
