'use strict';

/**
 * git_status tool — read-only git status.
 *
 * Runs `git status --short` in the working directory.
 * Does NOT add, commit, checkout, reset, clean, or push.
 */

const { execSync } = require('child_process');
const path = require('path');

function definition() {
  return {
    name: 'git_status',
    description: 'Show the current git status (short format). ' + 'Read-only: does not modify repository state.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the git repository (default: current directory)',
        },
      },
      required: [],
    },
  };
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const targetDir = args && args.path ? path.resolve(cwd, args.path) : cwd;

  try {
    const result = execSync('git status --short', {
      cwd: targetDir,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, text: result.trim() || 'Working tree clean' };
  } catch (err) {
    // git status returns exit code 128 when not in a git repo
    return { ok: false, text: `Error: ${err.message}` };
  }
}

module.exports = { definition, execute };
