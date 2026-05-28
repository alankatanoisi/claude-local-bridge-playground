'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SENSITIVE_AUTH_HEADER,
  getSensitiveEndpointToken,
  isAuthorizedSensitiveRequest,
  isSensitivePath,
} = require('../src/local-auth');

test('getSensitiveEndpointToken initializes and reuses the token', () => {
  const ctx = {};
  const token = getSensitiveEndpointToken(ctx);
  assert.ok(token);
  assert.equal(ctx.sensitiveEndpointToken, token);
  assert.equal(getSensitiveEndpointToken(ctx), token);
});

test('isSensitivePath guards debug endpoints', () => {
  assert.equal(isSensitivePath('/v1/debug'), true);
  assert.equal(isSensitivePath('/v1/debug/status'), true);
  assert.equal(isSensitivePath('/v1/messages'), false);
});

test('isAuthorizedSensitiveRequest accepts the custom debug token header', () => {
  const ctx = { sensitiveEndpointToken: 'door-code' };
  const req = { headers: { [SENSITIVE_AUTH_HEADER]: 'door-code' } };
  assert.equal(isAuthorizedSensitiveRequest(ctx, req), true);
});

test('isAuthorizedSensitiveRequest accepts bearer tokens and rejects mismatches', () => {
  const ctx = { sensitiveEndpointToken: 'door-code' };
  const okToken = 'door-code';
  const badToken = 'different';
  const okReq = { headers: { authorization: 'Bearer ' + okToken } };
  const badReq = { headers: { authorization: 'Bearer ' + badToken } };
  assert.equal(isAuthorizedSensitiveRequest(ctx, okReq), true);
  assert.equal(isAuthorizedSensitiveRequest(ctx, badReq), false);
});
