'use strict';

/**
 * P1-12 — CLI accepts https:// bridge URLs; the model client must select the
 * matching transport instead of assuming HTTP.
 *
 * Contract under test:
 *   - http:// URLs use the http module + http keep-alive agent (port 80 default)
 *   - https:// URLs use the https module + https keep-alive agent (port 443 default)
 *   - any other scheme fails with a typed, NON-retryable BridgeUrlError
 *     BEFORE any socket is opened
 *   - post() completes a real request against a local http mock bridge
 *   - the https path is exercised end-to-end: pointing an https:// URL at a
 *     plain-HTTP listener produces a TLS-layer failure (impossible unless the
 *     https client stack was actually selected)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');

const { post, postStream, transportFor, BridgeUrlError } = require('../../src/runner/model-client');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

describe('P1-12 protocol-aware bridge transport', () => {
  it('selects the http module for http:// URLs', () => {
    const t = transportFor(new URL('http://127.0.0.1:11437/v1/messages'));
    assert.equal(t.request, http.request);
    assert.equal(t.defaultPort, 80);
  });

  it('selects the https module for https:// URLs', () => {
    const t = transportFor(new URL('https://bridge.local/v1/messages'));
    assert.equal(t.request, https.request);
    assert.equal(t.defaultPort, 443);
  });

  it('rejects unsupported schemes with a typed, non-retryable error', () => {
    for (const bad of ['ftp://x/v1/messages', 'ws://x/v1/messages', 'file:///v1/messages']) {
      assert.throws(
        () => transportFor(new URL(bad)),
        (err) => err instanceof BridgeUrlError && err.retryable === false && /http:\/\/ or https:\/\//.test(err.message),
        bad,
      );
    }
  });

  it('post() rejects (typed) before any socket for an unsupported scheme', async () => {
    await assert.rejects(
      post({ model: 'm', messages: [] }, 'gopher://127.0.0.1:1/v1/messages'),
      (err) => err.name === 'BridgeUrlError' && err.retryable === false,
    );
    await assert.rejects(
      postStream({ model: 'm', messages: [] }, null, 'gopher://127.0.0.1:1/v1/messages'),
      (err) => err.name === 'BridgeUrlError' && err.retryable === false,
    );
  });

  it('post() completes a mock request over http', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_mock',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'transport ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    const port = await listen(server);
    try {
      const out = await post({ model: 'm', messages: [] }, 'http://127.0.0.1:' + port + '/v1/messages');
      assert.equal(out.content[0].text, 'transport ok');
      assert.equal(out._localBridge.status_code, 200);
    } finally {
      server.close();
    }
  });

  it('https:// URLs engage the TLS client stack end-to-end', async () => {
    // A plain-HTTP listener cannot complete a TLS handshake. If the client
    // errors at the TLS layer (not with "unsupported protocol" and not with a
    // successful HTTP response), the https transport was genuinely selected
    // and driven all the way to the socket.
    const server = http.createServer((req, res) => res.end('never reached over TLS'));
    const port = await listen(server);
    try {
      await assert.rejects(
        post({ model: 'm', messages: [] }, 'https://127.0.0.1:' + port + '/v1/messages'),
        (err) => err.name === 'BridgeNetworkError' && err.retryable === true,
      );
    } finally {
      server.close();
    }
  });
});
