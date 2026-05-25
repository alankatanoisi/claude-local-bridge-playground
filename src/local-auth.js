'use strict';

const { randomUUID, timingSafeEqual } = require('crypto');

const SENSITIVE_AUTH_HEADER = 'x-claude-local-bridge-debug-token';

function getSensitiveEndpointToken(ctx) {
  // Think of this as a temporary door code for the debug pages.
  // It is not an Anthropic or Claude token. It only protects local diagnostic
  // pages from another random process running on the same Mac.
  if (!ctx.sensitiveEndpointToken) {
    ctx.sensitiveEndpointToken = randomUUID();
  }
  return ctx.sensitiveEndpointToken;
}

function isSensitivePath(pathname) {
  // Debug endpoints reveal how the bridge is configured, so they get the extra
  // local door code. Normal model endpoints stay compatible with local clients.
  return pathname === '/v1/debug' || pathname.startsWith('/v1/debug/');
}

function readCallerToken(req) {
  const headerToken = req.headers[SENSITIVE_AUTH_HEADER];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

function safeTokenEquals(actual, expected) {
  if (!actual || !expected) return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;

  // timingSafeEqual avoids tiny timing clues when comparing secret strings.
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAuthorizedSensitiveRequest(ctx, req) {
  return safeTokenEquals(readCallerToken(req), getSensitiveEndpointToken(ctx));
}

module.exports = {
  SENSITIVE_AUTH_HEADER,
  getSensitiveEndpointToken,
  isAuthorizedSensitiveRequest,
  isSensitivePath,
};
