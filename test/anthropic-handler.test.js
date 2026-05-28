'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

function makeCtx() {
  return {
    outputChannel: { appendLine: () => {} },
    cachedCredentials: null,
    credentialsCachedAt: 0,
    CREDS_CACHE_TTL: 300_000,
  };
}

function makeReq(rawBody, headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  process.nextTick(() => {
    req.emit('data', Buffer.from(rawBody, 'utf8'));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    write(chunk) {
      this.body += chunk || '';
    },
    end(chunk = '') {
      this.body += chunk || '';
      this.writableEnded = true;
    },
  };
}

function loadAnthropicHandler(options = {}) {
  const credPath = require.resolve('../src/credentials');
  const proxyPath = require.resolve('../src/proxy');
  const anthropicPath = require.resolve('../src/handlers/anthropic');

  delete require.cache[anthropicPath];
  delete require.cache[proxyPath];
  delete require.cache[credPath];

  require.cache[credPath] = {
    id: credPath,
    filename: credPath,
    loaded: true,
    exports: {
      getCredentials: options.getCredentials || (() => ({ accessToken: 'oauth-token', source: 'mock' })),
      getCredentialAuthMode: options.getCredentialAuthMode || (() => 'bearer'),
      prependClaudeCodeSystem: options.prependClaudeCodeSystem || ((_ctx, body) => body),
      messagesPathFor: options.messagesPathFor || (() => '/v1/messages'),
    },
  };

  require.cache[proxyPath] = {
    id: proxyPath,
    filename: proxyPath,
    loaded: true,
    exports: {
      proxyToAnthropic: options.proxyToAnthropic || (async () => {}),
    },
  };

  return require('../src/handlers/anthropic');
}

describe('anthropic handler unit coverage', () => {
  it('returns a 400 when the request body is not valid JSON', async () => {
    let proxyCalls = 0;
    const { handleAnthropicMessages } = loadAnthropicHandler({
      proxyToAnthropic: async () => {
        proxyCalls += 1;
      },
    });

    const res = makeRes();
    await handleAnthropicMessages(makeCtx(), makeReq('{not-json'), res);

    assert.equal(proxyCalls, 0);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body), {
      error: { type: 'invalid_request_error', message: 'Invalid JSON body' },
    });
  });

  it('resolves model aliases, applies default max_tokens, and forwards the transformed body', async () => {
    const calls = [];
    const { handleAnthropicMessages } = loadAnthropicHandler({
      prependClaudeCodeSystem: (_ctx, body) => {
        body.system = [{ type: 'text', text: 'injected-system' }];
        return body;
      },
      messagesPathFor: () => '/v1/messages?beta=true',
      proxyToAnthropic: async (_ctx, _res, path, rawBody, stream, trace) => {
        calls.push({ path, body: JSON.parse(rawBody), stream, trace: !!trace });
      },
    });

    const req = makeReq(JSON.stringify({ model: 'claude-3-5-sonnet', messages: [{ role: 'user', content: 'hi' }] }), {
      'content-type': 'application/json',
    });
    const res = makeRes();
    await handleAnthropicMessages(makeCtx(), req, res);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/v1/messages?beta=true');
    assert.equal(calls[0].stream, false);
    assert.equal(calls[0].trace, false);
    assert.equal(calls[0].body.model, 'claude-3-5-sonnet-20241022');
    assert.equal(calls[0].body.max_tokens, 4096);
    assert.deepEqual(calls[0].body.system, [{ type: 'text', text: 'injected-system' }]);
  });
});
