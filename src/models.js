'use strict';

// ─────────────────────────────────────────────
// Model Registry
//
// Maps model IDs → canonical Anthropic model names + metadata.
// Pass-through is the default: if a model name is not found in the
// alias table, it is forwarded verbatim to api.anthropic.com.
// This lets callers use any current/future Anthropic model ID.
//
// The alias table exists purely to handle common shorthand names
// that third-party tools send (e.g. "claude-3-5-sonnet" without a date).
// ─────────────────────────────────────────────

/**
 * Alias → canonical Anthropic model ID.
 * Keys should be lowercase. Values are the exact IDs Anthropic accepts.
 */
const ALIASES = {
  // Current generation (4.5)
  'claude-opus-4-5': 'claude-opus-4-5',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-haiku-4-5': 'claude-haiku-4-5',

  // Shorthand → current default
  'claude-opus-4': 'claude-opus-4-5',
  'claude-sonnet-4': 'claude-sonnet-4-5',
  'claude-haiku-4': 'claude-haiku-4-5',

  // Previous gen (3.5) — specific dated
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',

  // Previous gen (3) — specific dated
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',

  // Generic "claude" → current default
  claude: 'claude-sonnet-4-5',

  // OpenAI model names — mapped for tools that send gpt-* names
  'gpt-4o': 'claude-sonnet-4-5',
  'gpt-4o-mini': 'claude-haiku-4-5',
  'gpt-4': 'claude-sonnet-4-5',
  'gpt-4-turbo': 'claude-sonnet-4-5',
  'gpt-3.5-turbo': 'claude-haiku-4-5',
  o1: 'claude-opus-4-5',
  'o1-mini': 'claude-sonnet-4-5',
  'o3-mini': 'claude-sonnet-4-5',

  // ollama / localai common shims
  llama3: 'claude-sonnet-4-5',
  mistral: 'claude-sonnet-4-5',
};

/** Models advertised in GET /v1/models */
const LISTED_MODELS = [
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 32000,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 64000,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 16384,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 8096,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 8096,
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 4096,
  },
  {
    id: 'claude-3-sonnet-20240229',
    name: 'Claude 3 Sonnet',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 4096,
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    owned_by: 'anthropic',
    context_length: 200000,
    output_length: 4096,
  },
];

const DEFAULT_MODEL = 'claude-sonnet-4-5';

/**
 * Resolve a model name to the canonical Anthropic model ID.
 * If the name is found in the alias table, the canonical name is returned.
 * Otherwise the name is returned verbatim (pass-through).
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

  const lower = requestedModel.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];

  // Try prefix match for versioned aliases (e.g. "claude-3-5-sonnet-20241022" → passthrough)
  // Pass through verbatim — Anthropic will reject unknown models with a clear error
  return requestedModel;
}

module.exports = { LISTED_MODELS, ALIASES, DEFAULT_MODEL, resolveModel };
