'use strict';

/**
 * Tool visibility has one explicit source of truth.
 *
 * The runner used to layer capability profiles over command-line flags. That
 * made it difficult to tell which setting won. Visibility now comes only from
 * the ordinary feature gates plus the user's optional --tools allowlist.
 *
 * Quarantined tools (for example apply_patch until its repair lands) are never
 * offered, even when named in --tools.
 */

const { TOOLS, DEFAULT_HIDDEN_TOOLS, QUARANTINED_TOOLS } = require('./tool-catalog');

function isBaseEligible(name, ctx) {
  if (QUARANTINED_TOOLS.has(name)) return false;
  if ((name === 'bash' || name === 'manage_shell_jobs') && !(ctx && ctx.allowShell)) return false;
  if (name === 'lsp_query' && !(ctx && ctx.enableLsp)) return false;
  if (name === 'spawn_agent' && (ctx?.spawnDepth || 0) > 0) return false;
  return true;
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
  if (ctx?.allowedTools) return ctx.allowedTools.has(name);
  if (!isBaseEligible(name, ctx)) return false;
  return !DEFAULT_HIDDEN_TOOLS.has(name);
}

module.exports = { computeAllowedTools, isToolVisible, isBaseEligible };
