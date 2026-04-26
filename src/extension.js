'use strict';

// Claude Local Bridge — VS Code Extension
// Reads Claude Code credentials and exposes an OpenAI/Anthropic-compatible
// local HTTP API on localhost:11436.
//
// Architecture:
//   HTTP server (:11436) → discover credentials (keychain/file/env)
//     → inject auth header → proxy to api.anthropic.com → stream back
//
// Credential priority:
//   1. ANTHROPIC_API_KEY env var
//   2. CLAUDE_CODE_OAUTH_TOKEN env var
//   3. macOS Keychain (Claude Code-credentials)
//   4. ~/.claude/.credentials.json
//   5. VS Code setting claudeLocalBridge.apiKey

const vscode = require('vscode');
const { createContext } = require('./context');
const { log } = require('./utils');
const { startServer, stopServer } = require('./server');
const { showStatus, showCredentialSource } = require('./handlers/debug');
const httpsInterceptor = require('./interceptors/https');

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

  log(ctx, 'Extension activated. Starting server...');
  startServer(ctx).catch((err) => log(ctx, `Startup error: ${err.message}`, true));
}

function deactivate() {
  httpsInterceptor.uninstall(ctx);
  stopServer(ctx);
}

module.exports = { activate, deactivate };
