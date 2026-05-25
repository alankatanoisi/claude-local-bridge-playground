'use strict';

// Claude Local Bridge — VS Code Extension
// Reads Claude Code credentials and exposes an OpenAI/Anthropic-compatible
// local HTTP API on localhost:11437.
//
// Architecture:
//   HTTP server (:11437) → discover OAuth credentials (intercept/keychain/file/env)
//     → inject auth header → proxy to api.anthropic.com → stream back
//
// Credential priority:
//   1. live intercepted Claude Code OAuth Bearer token
//   2. CLAUDE_CODE_OAUTH_TOKEN env var
//   3. macOS Keychain (Claude Code-credentials)
//   4. ~/.claude/.credentials.json
//
// This playground intentionally ignores Anthropic Console API keys so tests
// cannot accidentally mix subscription-OAuth and API-key billing paths.

const vscode = require('vscode');
const { createContext } = require('./context');
const { log } = require('./utils');
const { startServer, stopServer } = require('./server');
const { startCaptureProxy, stopCaptureProxy } = require('./capture-proxy');
const { showStatus, showCredentialSource } = require('./handlers/debug');
const httpsInterceptor = require('./interceptors/https');
const { initializeCallerAuth, tokenFingerprint } = require('./caller-auth');

/** @type {ReturnType<typeof createContext>} */
let ctx;

// ─────────────────────────────────────────────
// Activation
// ─────────────────────────────────────────────

function activate(context) {
  ctx = createContext();

  ctx.outputChannel = vscode.window.createOutputChannel('Claude Local Bridge');
  context.subscriptions.push(ctx.outputChannel);

  ctx.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  ctx.statusBarItem.command = 'claudeLocalBridge.showStatus';
  ctx.statusBarItem.tooltip = 'Claude Local Bridge — Click for status';
  context.subscriptions.push(ctx.statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeLocalBridge.start', () => startServer(ctx)),
    vscode.commands.registerCommand('claudeLocalBridge.stop', () => stopServer(ctx)),
    vscode.commands.registerCommand('claudeLocalBridge.showStatus', () => showStatus(ctx)),
    vscode.commands.registerCommand('claudeLocalBridge.showCredentialSource', () => showCredentialSource(ctx)),
  );

  // Install HTTPS interceptor first — it needs to be in place before
  // any other extension (like Claude Code) makes outgoing HTTPS requests.
  httpsInterceptor.install(ctx);

  log(ctx, 'Extension activated. Initializing caller auth...');
  initializeCallerAuth(ctx, context)
    .then(() => {
      const fp = tokenFingerprint(ctx.callerAuthToken);
      if (ctx.callerAuthToken) {
        log(ctx, `Caller auth initialized [${ctx.callerAuthTokenSource}] fingerprint=${fp}`);
      } else {
        log(ctx, `Caller auth disabled [${ctx.callerAuthTokenSource}]`);
      }

      log(ctx, 'Starting server...');
      return startServer(ctx);
    })
    .catch((err) => log(ctx, `Startup error: ${err.message}`, true));

  // Start auth capture proxy — Claude Code routes through this via HTTPS_PROXY
  startCaptureProxy(ctx);
}

function deactivate() {
  httpsInterceptor.uninstall(ctx);
  stopCaptureProxy(ctx);
  stopServer(ctx);
}

module.exports = { activate, deactivate };
