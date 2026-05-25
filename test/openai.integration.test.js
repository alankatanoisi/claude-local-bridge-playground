'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('https');

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
    socket: { setNoDelay: () => {} },
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
    flushHeaders() {},
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

function installHttpsScript(steps) {
  let callIndex = 0;
  const original = https.request;

  https.request = (options, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      const step = steps[callIndex++];
      if (!step) throw new Error('No scripted upstream response left');

      const upRes = new EventEmitter();
      upRes.statusCode = step.statusCode;
      upRes.headers = step.headers || {};
      upRes.resume = () => {};

      process.nextTick(() => {
        callback(upRes);
        for (const chunk of step.chunks || []) {
          upRes.emit('data', Buffer.from(chunk, 'utf8'));
        }
        upRes.emit('end');
      });
    };
    req.setTimeout = () => {};
    req.destroy = () => {};
    return req;
  };

  return {
    restore: () => {
      https.request = original;
    },
    getCallCount: () => callIndex,
  };
}

function loadOpenAIHandler(clearSpy) {
  const credPath = require.resolve('../src/credentials');
  const openaiPath = require.resolve('../src/handlers/openai');

  delete require.cache[openaiPath];
  delete require.cache[credPath];

  require.cache[credPath] = {
    id: credPath,
    filename: credPath,
    loaded: true,
    exports: {
      getCredentials: () => ({ accessToken: 'oauth-token', source: 'mock' }),
      buildAuthHeaders: () => ({ authorization: 'Bearer oauth-token' }),
      clearCredentialsCache: clearSpy,
      markCredentialsRejected: clearSpy,
      prependClaudeCodeSystem: (_ctx, body) => body,
      messagesPathFor: () => '/v1/messages',
    },
  };

  return require('../src/handlers/openai');
}

describe('openai integration', () => {
  let restoreHttps;

  beforeEach(() => {
    restoreHttps = null;
  });

  afterEach(() => {
    if (restoreHttps) restoreHttps();
  });

  it('converts streaming SSE with tool_calls, finish reasons, and [DONE]', async () => {
    const clearCalls = [];
    const { handleChatCompletions } = loadOpenAIHandler((ctx) => clearCalls.push(ctx));

    const sseEvents = [
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"search_docs"}}\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n',
      'data: [DONE]\n',
    ];

    const script = installHttpsScript([{ statusCode: 200, chunks: sseEvents }]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    const res = makeRes();
    await handleChatCompletions(makeCtx(), req, res);

    const output = res.writes.join('');
    assert.match(output, /"tool_calls":\[/);
    assert.match(output, /"finish_reason":"tool_calls"/);
    assert.match(output, /data: \[DONE\]\n\n/);
    assert.equal(clearCalls.length, 0);
  });

  it('converts non-streaming tool_use response into OpenAI tool_calls', async () => {
    const { handleChatCompletions } = loadOpenAIHandler(() => {});
    const upstreamBody = JSON.stringify({
      model: 'claude-sonnet-4-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Using a tool' },
        { type: 'tool_use', id: 'call_1', name: 'search_docs', input: { q: 'hello' } },
      ],
      usage: { input_tokens: 12, output_tokens: 8 },
    });

    const script = installHttpsScript([{ statusCode: 200, chunks: [upstreamBody] }]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'gpt-4o', stream: false, messages: [{ role: 'user', content: 'hi' }] });
    const res = makeRes();
    await handleChatCompletions(makeCtx(), req, res);

    const body = JSON.parse(res.writes.join(''));
    assert.equal(res.statusCode, 200);
    assert.equal(body.choices[0].finish_reason, 'tool_calls');
    assert.equal(body.choices[0].message.tool_calls[0].function.name, 'search_docs');
  });

  it('propagates non-200 JSON error body with status code', async () => {
    const { handleChatCompletions } = loadOpenAIHandler(() => {});
    const err = JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad request' } });

    const script = installHttpsScript([{ statusCode: 429, chunks: [err] }]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'gpt-4o', stream: false, messages: [] });
    const res = makeRes();
    await handleChatCompletions(makeCtx(), req, res);

    assert.equal(res.statusCode, 429);
    assert.deepEqual(JSON.parse(res.writes.join('')), JSON.parse(err));
  });

  it('normalizes non-200 invalid JSON error body fallback', async () => {
    const { handleChatCompletions } = loadOpenAIHandler(() => {});

    const script = installHttpsScript([{ statusCode: 502, chunks: ['<html>bad gateway</html>'] }]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'gpt-4o', stream: false, messages: [] });
    const res = makeRes();
    await handleChatCompletions(makeCtx(), req, res);

    const body = JSON.parse(res.writes.join(''));
    assert.equal(res.statusCode, 502);
    assert.equal(body.error.type, 'upstream_error');
    assert.match(body.error.message, /bad gateway/);
  });

  it('retries once on 401 then succeeds and clears credential cache once', async () => {
    const clearCalls = [];
    const { handleChatCompletions } = loadOpenAIHandler((ctx) => clearCalls.push(ctx));

    const success = JSON.stringify({
      model: 'claude-sonnet-4-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const script = installHttpsScript([
      { statusCode: 401, chunks: [JSON.stringify({ error: { message: 'unauthorized' } })] },
      { statusCode: 200, chunks: [success] },
    ]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'gpt-4o', stream: false, messages: [] });
    const res = makeRes();
    const ctx = makeCtx();
    await handleChatCompletions(ctx, req, res);

    assert.equal(script.getCallCount(), 2);
    assert.equal(clearCalls.length, 1);
    assert.strictEqual(clearCalls[0], ctx);
    assert.equal(res.statusCode, 200);
  });

  it('retries once on 401 then returns second 401 and clears cache once', async () => {
    const clearCalls = [];
    const { handleChatCompletions } = loadOpenAIHandler((ctx) => clearCalls.push(ctx));

    const script = installHttpsScript([
      { statusCode: 401, chunks: [JSON.stringify({ error: { message: 'unauthorized-1' } })] },
      { statusCode: 401, chunks: [JSON.stringify({ error: { message: 'unauthorized-2' } })] },
    ]);
    restoreHttps = script.restore;

    const req = makeReq({ model: 'gpt-4o', stream: false, messages: [] });
    const res = makeRes();
    await handleChatCompletions(makeCtx(), req, res);

    assert.equal(script.getCallCount(), 2);
    assert.equal(clearCalls.length, 1);
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.writes.join(''));
    assert.equal(body.error.message, 'unauthorized-2');
  });
});
