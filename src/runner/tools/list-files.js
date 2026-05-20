'use strict';

/**
 * list_files tool — read-only directory listing.
 *
 * Lists files and directories under a relative path.
 * Skips noisy folders (.git, node_modules, dist, build, coverage) by default.
 */

const fs = require('fs');
const path = require('path');
const { BLOCKED_DIRS } = require('../permissions');

function definition() {
  return {
    name: 'list_files',
    description:
      'List files and directories under a relative path. ' +
      'Skips .git, node_modules, dist, build, and coverage by default.',
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
  const cwd = ctx.cwd || process.cwd();
  const target = args && args.path ? path.resolve(cwd, args.path) : cwd;

  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const lines = [];
    for (const entry of entries) {
      if (BLOCKED_DIRS.includes(entry.name)) continue;
      const type = entry.isDirectory() ? 'dir' : 'file';
      lines.push(`${type}: ${entry.name}`);
    }
    return { ok: true, text: lines.join('\n') || '(empty directory)' };
  } catch (err) {
    return { ok: false, text: `Error: ${err.message}` };
  }
}

module.exports = { definition, execute };
