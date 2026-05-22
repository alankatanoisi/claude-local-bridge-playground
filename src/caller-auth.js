'use strict';

const crypto = require('crypto');
const vscode = require('vscode');

const CALLER_AUTH_TOKEN_SECRET = 'claudeLocalBridge.callerAuthToken';
const CALLER_AUTH_ROTATED_AT_SECRET = 'claudeLocalBridge.callerAuthRotatedAt';

function tokenFingerprint(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

async function initializeCallerAuth(ctx, extensionContext) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const requireCallerAuth = config.get('requireCallerAuth', false);
  const configuredToken = String(config.get('callerAuthToken', '') || '').trim();

  if (!requireCallerAuth) {
    ctx.callerAuthToken = null;
    ctx.callerAuthTokenSource = 'disabled';
    ctx.callerAuthTokenRotatedAt = null;
    return;
  }

  if (configuredToken) {
    ctx.callerAuthToken = configuredToken;
    ctx.callerAuthTokenSource = 'vscode-setting';
    ctx.callerAuthTokenRotatedAt = null;
    return;
  }

  const storedToken = await extensionContext.secrets.get(CALLER_AUTH_TOKEN_SECRET);
  if (storedToken) {
    ctx.callerAuthToken = storedToken;
    ctx.callerAuthTokenSource = 'secret-storage';
    const rotatedAtRaw = await extensionContext.secrets.get(CALLER_AUTH_ROTATED_AT_SECRET);
    const rotatedAt = rotatedAtRaw ? Number(rotatedAtRaw) : null;
    ctx.callerAuthTokenRotatedAt = Number.isFinite(rotatedAt) ? rotatedAt : null;
    return;
  }

  const generatedToken = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  await extensionContext.secrets.store(CALLER_AUTH_TOKEN_SECRET, generatedToken);
  await extensionContext.secrets.store(CALLER_AUTH_ROTATED_AT_SECRET, String(now));

  ctx.callerAuthToken = generatedToken;
  ctx.callerAuthTokenSource = 'secret-storage:auto-generated';
  ctx.callerAuthTokenRotatedAt = now;
}

module.exports = {
  tokenFingerprint,
  initializeCallerAuth,
};
