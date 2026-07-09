'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

require('./__mocks__/vscode');

const { formatLogTimestamp } = require('../src/utils');

describe('bridge output timestamps', () => {
  it('keeps the existing UTC clock format when UTC is configured', () => {
    const date = new Date('2026-07-09T00:08:10.618Z');

    assert.equal(formatLogTimestamp(date, 'utc'), '00:08:10.618');
  });

  it('can format the same moment in a named local timezone', () => {
    const date = new Date('2026-07-09T00:08:10.618Z');

    assert.equal(formatLogTimestamp(date, 'America/Los_Angeles'), '17:08:10.618');
  });

  it('falls back to local system time if the configured timezone is invalid', () => {
    const date = new Date('2026-07-09T00:08:10.618Z');

    assert.equal(formatLogTimestamp(date, 'not a real timezone'), formatLogTimestamp(date, 'local'));
  });
});
