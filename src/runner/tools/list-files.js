'use strict';

/**
 * list_files tool — read-only directory listing.
 *
 * Lists files and directories under a relative path.
 * Skips noisy folders (.git, node_modules, dist, build, coverage, actions-runner) by default.
 */

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { BLOCKED_DIRS } = safety;

function definition() {
  return {
    name: 'list_files',
    description:
      'List files and directories under a relative path. ' +
      'Skips .git, node_modules, dist, build, coverage, and actions-runner by default.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative directory path to list (default: current directory)',
        },
      },
      required: [],
    },
  };
}

function execute(args, ctx) {
  // HE-01 / N2: confine the directory itself (gate already checks args.path when
  // present; execute must not be a thinner second path that skips realpath).
  const relDir = args && typeof args.path === 'string' && args.path.trim() !== '' ? args.path : '.';
  const resolvedDir = safety.resolveFileTarget(ctx, relDir);
  if (!resolvedDir.allowed) {
    return { ok: false, text: resolvedDir.reason || 'Path not allowed: ' + relDir };
  }
  const target = resolvedDir.real || resolvedDir.lexical;

  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const lines = [];
    for (const entry of entries) {
      if (BLOCKED_DIRS.includes(entry.name)) continue;

      // Hide deny-listed basenames and innocent aliases that resolve to them
      // (Safari-2 shape). Prefer relative path under cwd so resolveFileTarget
      // can apply lexical + realpath deny checks.
      const entryRel =
        relDir === '.' || relDir === ''
          ? entry.name
          : path.posix.join(relDir.replace(/\\/g, '/').replace(/\/$/, ''), entry.name);
      const entryCheck = safety.resolveFileTarget(ctx, entryRel);
      if (!entryCheck.allowed) continue;

      const type = entry.isDirectory() ? 'dir' : 'file';
      lines.push(`${type}: ${entry.name}`);
    }
    return { ok: true, text: lines.join('\n') || '(empty directory)' };
  } catch (err) {
    return { ok: false, text: `Error: ${err.message}` };
  }
}

module.exports = { definition, execute, meta: { name: 'list_files', category: 'read-only' } };
