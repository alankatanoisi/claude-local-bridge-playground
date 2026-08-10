'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

// These failures are intentional fixtures. The normal prototype test command
// runs only test/*.test.js, so this file never makes the real suite fail.
test('fixture arithmetic expectation', () => {
  assert.equal(2 + 2, 5);
});

test('fixture status expectation', () => {
  assert.equal({ status: 'pending' }.status, 'completed');
});
