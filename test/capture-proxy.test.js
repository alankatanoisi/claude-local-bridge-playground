'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const https = require('node:https');
const { once } = require('node:events');
const { PassThrough, Readable } = require('node:stream');
const { createContext } = require('../src/context');
const { startCaptureProxy, stopCaptureProxy } = require('../src/capture-proxy');

async function requestProxy(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 11439,
        method: 'GET',
        path,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('capture proxy forwards allowed requests and rejects other targets', async () => {
  const ctx = createContext();
  ctx.outputChannel = { appendLine: () => {} };
  ctx.cachedCredentials = { accessToken: 'old-token' };
  ctx.credentialsCachedAt = 123;

  const originalRequest = https.request;
  let lastOptions = null;
  let requestCount = 0;
  https.request = (options, callback) => {
    lastOptions = options;
    requestCount += 1;
    const statusCode = requestCount === 1 ? 200 : 500;
    const body = requestCount === 1 ? 'proxied' : 'upstream error';
    const proxyRes = Readable.from([body]);
    proxyRes.statusCode = statusCode;
    proxyRes.headers = { 'content-type': 'text/plain' };
    process.nextTick(() => callback(proxyRes));
    return new PassThrough();
  };

  try {
    startCaptureProxy(ctx);
    await once(ctx.captureProxy, 'listening');

    const response = await requestProxy('https://api.anthropic.com/v1/messages', {
      authorization: 'Bearer ' + 'token-proxy',
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'proxied');
    assert.equal(lastOptions.hostname, 'api.anthropic.com');
    assert.equal(ctx.interceptedToken, 'token-proxy');
    assert.equal(ctx.interceptedHeaderType, 'bearer');
    assert.equal(ctx.interceptedSource, 'proxy:bearer');
    assert.equal(ctx.interceptedHost, 'api.anthropic.com');
    assert.equal(ctx.cachedCredentials, null);

    const errorResponse = await requestProxy('https://api.anthropic.com/v1/messages?force_error=1');
    assert.equal(errorResponse.statusCode, 500);
    assert.equal(errorResponse.body, 'upstream error');

    const blockedResponse = await requestProxy('https://example.com/v1/messages');

    assert.equal(blockedResponse.statusCode, 403);
    assert.ok(blockedResponse.body.includes('Proxy target not allowed'));
  } finally {
    const server = ctx.captureProxy;
    stopCaptureProxy(ctx);
    if (server) await once(server, 'close');
    https.request = originalRequest;
  }
});
