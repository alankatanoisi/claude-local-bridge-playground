'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('https');
const fs = require('fs');
const { defaultBridgeTracePath } = require('../src/trace-utils');

function makeCtx() {
  return {
    outputChannel: { appendLine: () => {} },
    cachedCredentials: null,
    credentialsCachedAt: 0,
    CREDS_CACHE_TTL: 300_000,
  };
}

function makeReq(bodyObj) {
  const req = new EventEmitter();
  req.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(bodyObj), 'utf8'));
    req.emit('end');
  });
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    writes: [],
    ended: false,
    headersSent: false,
    writableEnded: false,
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
    writeHead(code, headers = {}) {
      this.statusCode = code;
      this.headersSent = true;
      for (const [k, v] of Object.entries(headers)) {
        this.headers[k.toLowerCase()] = v;
      }
    },
    write(chunk) {
      this.writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    },
    end(chunk) {
      if (chunk !== undefined) this.write(chunk);
      this.ended = true;
      this.writableEnded = true;
    },
  };
}

function installHttpsScript(steps, options = {}) {
  let callIndex = 0;
  const capturedBodies = options.captureBodies ? [] : null;
  const original = https.request;

  https.request = (_options, callback) => {
    const req = new EventEmitter();
    req.write = (chunk) => {
      if (capturedBodies) capturedBodies.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    };
    req.end = (chunk) => {
      if (chunk && capturedBodies) {
        capturedBodies.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      }
      const step = steps[callIndex++];
      if (!step) throw new Error('No scripted upstream response left');

      const upRes = new EventEmitter();
      upRes.statusCode = step.statusCode;
      upRes.headers = step.headers || {};
      upRes.resume = () => {
        process.nextTick(() => upRes.emit('end'));
      };

      process.nextTick(() => {
        callback(upRes);
        for (const chunk of step.chunks || []) {
          upRes.emit('data', Buffer.from(chunk, 'utf8'));
        }
        upRes.emit('end');
      });
    };
    req.destroy = () => {};
    return req;
  };

  return {
    restore: () => {
      https.request = original;
    },
    getCallCount: () => callIndex,
    getCapturedBodies: () => capturedBodies,
  };
}

function loadAnthropicHandler(clearSpy) {
  const credPath = require.resolve('../src/credentials');
  const anthropicPath = require.resolve('../src/handlers/anthropic');
  const proxyPath = require.resolve('../src/proxy');

  delete require.cache[anthropicPath];
  delete require.cache[proxyPath];
  delete require.cache[credPath];

  require.cache[credPath] = {
    id: credPath,
    filename: credPath,
    loaded: true,
    exports: {
      getCredentials: () => ({ accessToken: 'oauth-token', source: 'mock' }),
      getCredentialAuthMode: () => 'bearer',
      buildAuthHeaders: () => ({ authorization: 'Bearer oauth-token' }),
      clearCredentialsCache: clearSpy,
      markCredentialsRejected: clearSpy,
      prependClaudeCodeSystem: (_ctx, body) => body,
      messagesPathFor: () => '/v1/messages',
    },
  };

  return require('../src/handlers/anthropic');
}

describe('anthropic pass-through integration', () => {
  let restoreHttps;

  beforeEach(() => {
    restoreHttps = null;
  });

  afterEach(() => {
    if (restoreHttps) restoreHttps();
  });

  it('retries once on 401 in proxy and passes through second 200 body', async () => {
    const clearCalls = [];
    const { handleAnthropicMessages } = loadAnthropicHandler((ctx) => clearCalls.push(ctx));

    const script = installHttpsScript([
      { statusCode: 401, chunks: [JSON.stringify({ error: { message: 'expired' } })] },
      {
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_123' },
        chunks: [JSON.stringify({ type: 'message', id: 'msg_1', content: [{ type: 'text', text: 'ok' }] })],
      },
    ]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] });
    const res = makeRes();
    const ctx = makeCtx();
    await handleAnthropicMessages(ctx, req, res);

    assert.equal(script.getCallCount(), 2);
    assert.equal(clearCalls.length, 1);
    assert.strictEqual(clearCalls[0], ctx);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json');
    const body = JSON.parse(res.writes.join(''));
    assert.equal(body.id, 'msg_1');
  });

  it('writes correlated bridge trace events when a trace header is present', async () => {
    const traceId = 'trace_bridge_test_' + Date.now();
    const tracePath = defaultBridgeTracePath(traceId);
    const { handleAnthropicMessages } = loadAnthropicHandler(() => {});
    const script = installHttpsScript([
      {
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_trace' },
        chunks: [JSON.stringify({ type: 'message', id: 'msg_trace', content: [{ type: 'text', text: 'ok' }] })],
      },
    ]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'trace me' }] });
    req.headers['x-local-bridge-trace-level'] = 'summary';
    req.headers['x-local-bridge-trace-id'] = traceId;
    req.headers['x-local-bridge-run-id'] = traceId;
    req.headers['x-local-bridge-trace-turn'] = '1';
    const res = makeRes();

    try {
      await handleAnthropicMessages(makeCtx(), req, res);
      const events = fs
        .readFileSync(tracePath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === 'bridge_request_received'));
      assert.ok(events.some((event) => event.type === 'bridge_request_transformed'));
      assert.ok(events.some((event) => event.type === 'upstream_request_started'));
      assert.ok(events.some((event) => event.type === 'upstream_response_finished'));
      assert.equal(events.find((event) => event.type === 'bridge_request_received').payload, undefined);
    } finally {
      fs.rmSync(tracePath, { force: true });
    }
  });

  it('forwards output_config.effort unchanged to upstream', async () => {
    const { handleAnthropicMessages } = loadAnthropicHandler(() => {});
    const script = installHttpsScript(
      [
        {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          chunks: [JSON.stringify({ type: 'message', id: 'msg_effort', content: [{ type: 'text', text: 'ok' }] })],
        },
      ],
      { captureBodies: true },
    );
    restoreHttps = script.restore;

    const req = makeReq({
      model: 'claude-sonnet-4-6',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'high' },
    });
    const res = makeRes();
    await handleAnthropicMessages(makeCtx(), req, res);

    const upstreamBody = JSON.parse(script.getCapturedBodies().join(''));
    assert.deepEqual(upstreamBody.output_config, { effort: 'high' });
    assert.equal(res.statusCode, 200);
  });
});
