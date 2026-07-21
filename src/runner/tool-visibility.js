'use strict';

/**
 * Tool visibility has one explicit source of truth.
 *
 * The runner used to layer capability profiles over command-line flags. That
 * made it difficult to tell which setting won. Visibility now comes from the
 * ordinary feature gates plus, in order of precedence:
 *
 *   1. `--tools` exact allowlist (power-user override; gates still apply)
 *   2. capability groups: `core` is always on; other groups need an explicit
 *      opt-in (`--capabilities`, `--allow-shell`, `--enable-lsp`) — P2-01
 *
 * Quarantined tools are never offered, even when named in --tools.
 * (apply_patch was quarantined until P0-06 repair; it is hidden-by-default
 * now, and only an exact `--tools apply_patch` allowlist exposes it.)
 */

const {
  TOOLS,
  TOOL_GROUPS,
  DEFAULT_HIDDEN_TOOLS,
  QUARANTINED_TOOLS,
  OPTIONAL_CAPABILITIES,
} = require('./tool-catalog');

// Hard gates that apply on every path, including a --tools allowlist. These
// are consent flags, not preferences: naming a gated tool in --tools must not
// bypass the flag that grants its authority.
function isBaseEligible(name, ctx) {
  if (QUARANTINED_TOOLS.has(name)) return false;
  if ((name === 'bash' || name === 'manage_shell_jobs') && !(ctx && ctx.allowShell)) return false;
  if (name === 'lsp_query' && !isLspEnabled(ctx)) return false;
  if (name === 'spawn_agent' && (ctx?.spawnDepth || 0) > 0) return false;
  return true;
}

function isLspEnabled(ctx) {
  if (!ctx) return false;
  if (ctx.enableLsp) return true;
  return !!(ctx.enabledCapabilities instanceof Set && ctx.enabledCapabilities.has('lsp'));
}

// P2-01: is this tool's capability group switched on for the run?
// `core` is always on; `shell`/`lsp` ride their dedicated flags via
// isBaseEligible, so reaching here with those groups just needs the flag
// check to have already passed.
function isGroupEnabled(name, ctx) {
  const group = TOOL_GROUPS[name];
  if (group === 'core') return true;
  if (group === 'shell') return !!(ctx && ctx.allowShell);
  if (group === 'lsp') return isLspEnabled(ctx);
  return !!(ctx && ctx.enabledCapabilities instanceof Set && ctx.enabledCapabilities.has(group));
}

function computeAllowedTools(ctx) {
  const cliList = ctx?._cliToolAllowlist || null;
  if (!cliList) return null;

  const exposed = new Set();
  for (const name of Object.keys(TOOLS)) {
    if (!isBaseEligible(name, ctx)) continue;
    if (!cliList.has(name)) continue;
    exposed.add(name);
  }
  return exposed;
}

function isToolVisible(name, ctx) {
  if (QUARANTINED_TOOLS.has(name)) return false;
  // --tools exact allowlist wins (it already went through isBaseEligible in
  // computeAllowedTools, and may deliberately expose hidden tools like
  // apply_patch).
  if (ctx?.allowedTools) return ctx.allowedTools.has(name);
  if (!isBaseEligible(name, ctx)) return false;
  if (!isGroupEnabled(name, ctx)) return false;
  return !DEFAULT_HIDDEN_TOOLS.has(name);
}

/**
 * Parse and validate a `--capabilities` value (comma-separated group names).
 * Returns a Set of enabled optional groups, or throws with a beginner-friendly
 * message. `shell` is rejected on purpose: shell consent stays on
 * --allow-shell only. `core` is accepted but redundant.
 */
function normalizeCapabilityList(raw) {
  if (raw === null || raw === undefined || raw === '') return new Set();
  const items =
    raw instanceof Set
      ? [...raw]
      : Array.isArray(raw)
        ? raw
        : String(raw)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
  const enabled = new Set();
  for (const item of items) {
    const name = item.toLowerCase();
    if (name === 'core') continue; // always on
    if (name === 'shell') {
      throw new Error(
        'capability "shell" cannot be enabled via --capabilities; use --allow-shell (explicit consent flag).',
      );
    }
    if (!OPTIONAL_CAPABILITIES.includes(name)) {
      throw new Error(
        'unknown capability "' +
          item +
          '". Valid choices: ' +
          OPTIONAL_CAPABILITIES.join(', ') +
          ' (plus --allow-shell for shell).',
      );
    }
    enabled.add(name);
  }
  return enabled;
}

module.exports = {
  computeAllowedTools,
  isToolVisible,
  isBaseEligible,
  isGroupEnabled,
  normalizeCapabilityList,
};
