'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBridgeUrl, resolveBridgeUrl } = require('../../bin/local-bridge-runner');

describe('runner bridge url CLI helpers', () => {
  it('normalizes a bridge root to the Anthropic Messages endpoint', () => {
    assert.equal(
      normalizeBridgeUrl('http://host.docker.internal:11437'),
      'http://host.docker.internal:11437/v1/messages',
    );
  });

  it('keeps an explicit Messages endpoint unchanged', () => {
    assert.equal(normalizeBridgeUrl('http://127.0.0.1:11437/v1/messages'), 'http://127.0.0.1:11437/v1/messages');
  });

  it('prefers --bridge-url over BRIDGE_RUNNER_BRIDGE_URL', () => {
    assert.equal(
      resolveBridgeUrl(
        { 'bridge-url': 'http://cli.example:11437' },
        { BRIDGE_RUNNER_BRIDGE_URL: 'http://env.example:11437' },
      ),
      'http://cli.example:11437/v1/messages',
    );
  });

  it('uses BRIDGE_RUNNER_BRIDGE_URL when the CLI flag is absent', () => {
    assert.equal(
      resolveBridgeUrl({}, { BRIDGE_RUNNER_BRIDGE_URL: 'http://env.example:11437/v1' }),
      'http://env.example:11437/v1/messages',
    );
  });

  it('rejects non-http bridge urls', () => {
    assert.throws(() => normalizeBridgeUrl('file:///tmp/bridge'), /http:\/\/ or https:\/\//);
  });
});
