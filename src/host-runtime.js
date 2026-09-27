'use strict';

// The bridge needs settings and two display helpers, not an entire editor.
// In an extension these calls still go to real VS Code. A standalone process
// explicitly supplies settings before starting the server; no module mocking
// or automatic environment-variable escape hatch is involved.
let standaloneSettings = null;

function configureStandalone(settings) {
  if (standaloneSettings) throw new Error('Standalone host is already configured');
  standaloneSettings = Object.freeze({ ...settings });
}

function getConfiguration() {
  if (standaloneSettings) {
    return { get: (key, fallback) => standaloneSettings[key] ?? fallback };
  }
  // Load lazily: plain Node.js never attempts to import the editor-only module.
  return require('vscode').workspace.getConfiguration('claudeLocalBridge');
}

function showInformationMessage(message) {
  if (!standaloneSettings) return require('vscode').window.showInformationMessage(message);
}

function warningBackground() {
  if (!standaloneSettings) return new (require('vscode').ThemeColor)('statusBarItem.warningBackground');
}

module.exports = { configureStandalone, getConfiguration, showInformationMessage, warningBackground };
