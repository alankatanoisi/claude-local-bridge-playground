'use strict';

/**
 * exit_worktree — leave the active worktree and optionally clean it up.
 *
 * Restores ctx.cwd / ctx.cwdRealpath to the original values captured by
 * enter_worktree. With cleanup=true, removes the worktree directory and
 * deletes the branch. Default is cleanup=false so the model's work is
 * preserved for manual review.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');

function definition() {
  return {
    name: 'exit_worktree',
    description:
      'Leave the active worktree and restore the original cwd. ' +
      'cleanup=true removes the worktree and deletes its branch (default: false — keep work for review).',
    input_schema: {
      type: 'object',
      properties: {
        cleanup: {
          type: 'boolean',
          description: 'If true, remove the worktree directory and delete the branch.',
        },
      },
      required: [],
    },
  };
}

function git(args, cwd, { timeoutMs = 10000 } = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function execute(args, ctx) {
  if (!ctx.worktree) {
    return { ok: false, text: 'No worktree is active. Call enter_worktree first.' };
  }

  const wt = ctx.worktree;
  const cleanup = !!(args && args.cleanup);
  const notes = [];

  ctx.cwd = wt.originalCwd;
  ctx.cwdRealpath = wt.originalCwdRealpath;

  if (cleanup) {
    try {
      git(['worktree', 'remove', '--force', wt.path], wt.repoRoot);
      notes.push('Removed worktree directory.');
    } catch (err) {
      notes.push('worktree remove failed: ' + (err.stderr || err.message).toString().trim());
      if (fs.existsSync(wt.path)) {
        notes.push('Worktree path still exists at ' + wt.path);
      }
    }
    try {
      git(['branch', '-D', wt.branch], wt.repoRoot);
      notes.push('Deleted branch ' + wt.branch + '.');
    } catch (err) {
      notes.push('branch delete failed: ' + (err.stderr || err.message).toString().trim());
    }
  } else {
    notes.push('Kept worktree at ' + wt.path + ' (branch ' + wt.branch + ').');
    notes.push('Clean up manually with: git worktree remove ' + wt.path);
  }

  delete ctx.worktree;

  return {
    ok: true,
    text: 'Exited worktree.\n  ' + notes.join('\n  '),
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'exit_worktree', category: 'worktree' },
};
