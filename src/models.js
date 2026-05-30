'use strict';

// ─────────────────────────────────────────────
// Model Registry
//
// This playground now stays on Anthropic's native Messages API shape.
// Model IDs are forwarded verbatim so the upstream Anthropic API remains the
// source of truth for current and future model names.
// ─────────────────────────────────────────────

const DEFAULT_MODEL = 'claude-sonnet-4-5';

/**
 * Resolve a model name for an Anthropic Messages request.
 * Unknown and future model IDs pass through unchanged, so the bridge does not
 * need its own model catalog.
 *
 * @param {string|undefined} requestedModel
 * @param {import('vscode')} vscode Optional vscode module to read settings
 * @returns {string}
 */
function resolveModel(requestedModel, vscode) {
  if (!requestedModel) {
    // Fall back to VS Code setting or hardcoded default
    if (vscode) {
      const config = vscode.workspace.getConfiguration('claudeLocalBridge');
      return config.get('defaultModel', DEFAULT_MODEL);
    }
    return DEFAULT_MODEL;
  }

  return requestedModel;
}

module.exports = { DEFAULT_MODEL, resolveModel };
