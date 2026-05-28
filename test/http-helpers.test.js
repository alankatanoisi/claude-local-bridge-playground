'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const vscode = require('./__mocks__/vscode');
const {
  sendJson,
  readBody,
  verboseLog,
  updateStatusBar,
  buildStreamChunk,
  buildCompletion,
} = require('../src/utils');
const { handleDebug, showStatus, showCredentialSource } = require('../src/handlers/debug');
const { handleModels } = require('../src/handlers/models');
const { handleCountTokens } = require('../src/handlers/anthropic');
const { handleRequest, parseBearerToken, isCallerAuthExempt } = require('../src/server');

function makeCtx() {
  return {
    outputChannel: { appendLine: () => {} },
    cachedCredentials: null,
    credentialsCachedAt: 0,
    CREDS_CACHE_TTL: 300_000,
  };
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

function makeBodyReq(chunks) {
  const req = new EventEmitter();
  let destroyed = false;
  req.destroy = (err) => {
    destroyed = true;
    process.nextTick(() => req.emit('error', err));
  };
  process.nextTick(() => {
    for (const chunk of chunks) {
      if (destroyed) return;
      req.emit('data', Buffer.from(chunk, 'utf8'));
    }
    if (destroyed) return;
    req.emit('end');
  });
  return req;
}

describe('utils helpers', () => {
  let originalInfo;

  beforeEach(() => {
    vscode.__resetConfig();
    originalInfo = vscode.window.showInformationMessage;
  });

  afterEach(() => {
    vscode.window.showInformationMessage = originalInfo;
    vscode.__resetConfig();
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  it('sendJson writes a JSON response with the expected content type', () => {
    const res = makeRes();
    sendJson(res, 202, { ok: true });

    assert.equal(res.statusCode, 202);
    assert.equal(res.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(res.body), { ok: true });
  });

  it('readBody concatenates incoming chunks', async () => {
    const body = await readBody(makeBodyReq(['{"hel', 'lo":"world"}']));
    assert.equal(body, '{"hello":"world"}');
  });

  it('readBody rejects oversized payloads', async () => {
    await assert.rejects(() => readBody(makeBodyReq(['abcdef']), 5), /exceeds 5 bytes/);
  });

  it('verboseLog only logs when request logging is enabled', () => {
    const lines = [];
    const ctx = { outputChannel: { appendLine: (line) => lines.push(line) } };

    verboseLog(ctx, 'hidden');
    vscode.__setConfig('logRequests', true);
    verboseLog(ctx, 'visible');

    assert.equal(lines.length, 1);
    assert.match(lines[0], /visible/);
  });

  it('updateStatusBar toggles running and stopped states', () => {
    const statusBarItem = {
      text: '',
      backgroundColor: undefined,
      showCalls: 0,
      show() {
        this.showCalls += 1;
      },
    };

    updateStatusBar({ statusBarItem }, true, 11437, 'env:CLAUDE_CODE_OAUTH_TOKEN');
    assert.match(statusBarItem.text, /Claude Bridge :11437 \[env:CLAUDE_CODE_OAUTH_TOKEN\]/);
    assert.equal(statusBarItem.backgroundColor, undefined);

    updateStatusBar({ statusBarItem }, false);
    assert.equal(statusBarItem.text, '$(warning) Claude Bridge OFF');
    assert.equal(statusBarItem.backgroundColor.id, 'statusBarItem.warningBackground');
    assert.equal(statusBarItem.showCalls, 2);
  });

  it('buildStreamChunk and buildCompletion return OpenAI-compatible payloads', () => {
    const chunk = buildStreamChunk('chatcmpl_1', 'claude-sonnet-4-5', null, 'stop');
    const completion = buildCompletion('chatcmpl_2', 'claude-sonnet-4-5', 'hello');

    assert.deepEqual(chunk.choices[0], { index: 0, delta: {}, finish_reason: 'stop' });
    assert.equal(completion.choices[0].message.content, 'hello');
    assert.equal(completion.usage.total_tokens, 0);
  });

  it('handleCountTokens returns a mock zero-token response', () => {
    const res = makeRes();
    handleCountTokens({}, {}, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { input_tokens: 0 });
  });

  it('handleModels returns an OpenAI-compatible model listing', () => {
    const res = makeRes();
    handleModels({}, {}, res);
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.equal(body.object, 'list');
    assert.ok(body.data.length > 0);
    assert.deepEqual(Object.keys(body.data[0]).sort(), [
      'context_length',
      'created',
      'id',
      'object',
      'output_length',
      'owned_by',
    ]);
  });

  it('handleDebug redacts local secrets but exposes useful diagnostics', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token-123';
    vscode.__setConfig('requireCallerAuth', true);
    vscode.__setConfig('anthropicBaseUrl', 'https://staging.anthropic.test');

    const ctx = makeCtx();
    ctx.server = { address: () => ({ port: 11999 }) };
    ctx.sessionId = 'sess_test';
    ctx.extensionVersion = '1.2.3';
    ctx.callerAuthToken = 'local-caller-token';
    ctx.callerAuthTokenSource = 'secret-storage:auto-generated';
    ctx.callerAuthTokenRotatedAt = 1_700_000_000_000;
    ctx.interceptedToken = 'live-oauth-token';
    ctx.rejectedInterceptedToken = 'live-oauth-token';
    ctx.rejectedInterceptedAt = 1_700_000_100_000;
    ctx.interceptedHeaderType = 'bearer';
    ctx.interceptedSource = 'intercepted:bearer';
    ctx.interceptedHost = '127.0.0.1';
    ctx.interceptedPort = 443;
    ctx.liveFingerprint = {
      endpoint: 'https://api.anthropic.com',
      messagesPath: '/v1/messages',
      'user-agent': 'claude-cli/test',
      'anthropic-beta': 'beta-test',
    };
    ctx.liveFingerprintCapturedAt = 1_700_000_200_000;

    const res = makeRes();
    await handleDebug(ctx, {}, res);
    const body = JSON.parse(res.body);

    assert.equal(body.status, 'running');
    assert.equal(body.port, 11999);
    assert.equal(body.credentialSource, 'env:CLAUDE_CODE_OAUTH_TOKEN');
    assert.equal(body.upstreamAuthMode, 'bearer');
    assert.equal(body.callerAuth.token, '[REDACTED]');
    assert.equal(body.interceptedToken, '[redacted]');
    assert.equal(body.interceptedCredentialRejected, true);
    assert.match(body.interceptedTokenFingerprint, /^sha256:/);
    assert.deepEqual(body.liveFingerprint.headers.sort(), ['anthropic-beta', 'user-agent']);
    assert.equal(body.anthropicBaseUrl, 'https://staging.anthropic.test');
  });

  it('showStatus reports running state and credential source', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token-123';
    const messages = [];
    vscode.window.showInformationMessage = (message) => messages.push(message);

    await showStatus({
      server: { listening: true, address: () => ({ port: 11437 }) },
      outputChannel: { appendLine: () => {} },
      cachedCredentials: null,
      credentialsCachedAt: 0,
      CREDS_CACHE_TTL: 300_000,
    });

    assert.equal(messages.length, 1);
    assert.match(messages[0], /✅ running on :11437/);
    assert.match(messages[0], /env:CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(messages[0], /Authenticated: ✅ yes/);
  });

  it('showCredentialSource explains both authenticated and missing-token states', async () => {
    const messages = [];
    vscode.window.showInformationMessage = (message) => messages.push(message);

    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token-123';
    await showCredentialSource(makeCtx());
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CONFIG_DIR = '/tmp/claude-local-bridge-missing-creds';

    const ctx = makeCtx();
    ctx.rejectedInterceptedToken = 'oauth-token-123';
    await showCredentialSource(ctx);

    assert.match(messages[0], /authenticated via: CLAUDE_CODE_OAUTH_TOKEN environment variable/);
    assert.match(messages[1], /no OAuth token found/i);
  });
});

describe('server routing helpers', () => {
  beforeEach(() => {
    vscode.__resetConfig();
  });

  afterEach(() => {
    vscode.__resetConfig();
  });

  it('parseBearerToken trims valid bearer tokens and rejects invalid headers', () => {
    assert.equal(parseBearerToken(['Bearer', 'token-123  '].join(' ')), 'token-123');
    assert.equal(parseBearerToken('Basic abc'), null);
    assert.equal(parseBearerToken('Bearer    '), null);
    assert.equal(parseBearerToken(undefined), null);
  });

  it('isCallerAuthExempt only exempts GET /v1/debug', () => {
    assert.equal(isCallerAuthExempt({ method: 'GET' }, '/v1/debug'), true);
    assert.equal(isCallerAuthExempt({ method: 'POST' }, '/v1/debug'), false);
    assert.equal(isCallerAuthExempt({ method: 'GET' }, '/v1/models'), false);
  });

  it('rejects non-local origins before routing', async () => {
    const res = makeRes();
    await handleRequest(makeCtx(), { method: 'GET', url: '/v1/models', headers: { origin: 'https://evil.example' } }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(res.body).error.type, 'forbidden');
  });

  it('answers localhost CORS preflight requests', async () => {
    const res = makeRes();
    await handleRequest(makeCtx(), { method: 'OPTIONS', url: '/v1/models', headers: { origin: 'http://localhost:3000' } }, res);

    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.match(res.headers['access-control-allow-headers'], /x-claude-local-bridge-debug-token/);
  });

  it('enforces caller auth on normal API routes', async () => {
    vscode.__setConfig('requireCallerAuth', true);
    const ctx = makeCtx();
    ctx.callerAuthToken = 'expected-token';

    const res = makeRes();
    await handleRequest(ctx, { method: 'GET', url: '/v1/models', headers: {} }, res);

    const body = JSON.parse(res.body);
    const expectedAuthenticate = '\x42earer realm=' + '"claude-local-bridge"';
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['www-authenticate'], expectedAuthenticate);
    assert.equal(body.error.code, 'caller_auth_missing');
  });

  it('uses the separate debug-token gate on /v1/debug even when caller auth is enabled', async () => {
    vscode.__setConfig('requireCallerAuth', true);
    const ctx = makeCtx();
    ctx.callerAuthToken = 'expected-token';
    ctx.sensitiveEndpointToken = 'debug-door-code';

    const res = makeRes();
    await handleRequest(ctx, { method: 'GET', url: '/v1/debug', headers: {} }, res);

    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 401);
    assert.equal(body.error.code, undefined);
    assert.match(body.error.message, /Debug endpoint locked/);
  });

  it('returns a not_found error for unknown routes', async () => {
    const res = makeRes();
    await handleRequest(makeCtx(), { method: 'GET', url: '/does-not-exist', headers: {} }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(JSON.parse(res.body).error.type, 'not_found');
  });
});
