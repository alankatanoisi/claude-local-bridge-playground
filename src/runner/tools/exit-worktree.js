'use strict';

/**
 * exit_worktree — leave a worktree slot and optionally clean it up.
 */

const fs = require('fs');
const {
  git,
  normalizeSlot,
  ensureWorktreeState,
  syncWorktreeAlias,
  deactivateToRepoRoot,
} = require('../worktree-utils');

function definition() {
  return {
    name: 'exit_worktree',
    description:
      'Leave a worktree slot and restore cwd to the repo root (or another active slot). ' +
      'cleanup=true removes the worktree directory and deletes its branch.',
    input_schema: {
      type: 'object',
      properties: {
        slot: {
          type: 'string',
          description: 'Worktree slot to exit (default: active slot).',
        },
        cleanup: {
          type: 'boolean',
          description: 'If true, remove the worktree directory and delete the branch.',
        },
      },
      required: [],
    },
  };
}

function execute(args, ctx) {
  ensureWorktreeState(ctx);
  const slot = normalizeSlot((args && args.slot) || ctx.activeWorktreeSlot);
  const wt = ctx.worktrees[slot];

  if (!wt) {
    return { ok: false, text: 'No worktree slot "' + slot + '" is active in this run.' };
  }

  const cleanup = !!(args && args.cleanup);
  const notes = [];
  const wasActive = ctx.activeWorktreeSlot === slot;

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

  delete ctx.worktrees[slot];

  if (wasActive) {
    const remaining = Object.keys(ctx.worktrees);
    if (remaining.length) {
      const nextSlot = remaining[0];
      ctx.activeWorktreeSlot = nextSlot;
      ctx.cwd = ctx.worktrees[nextSlot].path;
      ctx.cwdRealpath = ctx.worktrees[nextSlot].path;
      notes.push('Switched active cwd to slot "' + nextSlot + '".');
    } else {
      deactivateToRepoRoot(ctx);
    }
  }
  syncWorktreeAlias(ctx);

  return {
    ok: true,
    text: 'Exited worktree slot "' + slot + '".\n  ' + notes.join('\n  '),
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'exit_worktree', category: 'worktree' },
};
