'use strict';

/**
 * enter_worktree — create or switch to an isolated git worktree slot.
 *
 * Multiple slots can exist per run (parallel orchestration). Each slot gets its
 * own branch under bridge-runner/ and directory under ~/.bridge-runner/worktrees/.
 */

const fs = require('fs');
const path = require('path');
const {
  BRANCH_PREFIX,
  git,
  sanitizeBranchSuffix,
  makeBranchSuffix,
  findRepoRoot,
  ensureWorktreeDir,
  normalizeSlot,
  ensureWorktreeState,
  saveRepoRoot,
  activateSlot,
} = require('../worktree-utils');

function definition() {
  return {
    name: 'enter_worktree',
    description:
      'Create an isolated git worktree on a fresh branch and switch the runner into it. ' +
      'Use slot to manage multiple parallel worktrees in one run (switch by re-entering the same slot). ' +
      'Requires the cwd to be a git repository.',
    input_schema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'Optional branch name suffix (sanitized). Defaults to a generated id.',
        },
        slot: {
          type: 'string',
          description: 'Named worktree slot (default: "default"). Re-enter an existing slot to switch cwd.',
        },
        description: {
          type: 'string',
          description: 'Optional short description recorded for logging.',
        },
      },
      required: [],
    },
  };
}

function execute(args, ctx) {
  const slot = normalizeSlot(args && args.slot);
  ensureWorktreeState(ctx);

  if (ctx.worktrees[slot]) {
    activateSlot(ctx, slot);
    const wt = ctx.worktrees[slot];
    return {
      ok: true,
      text:
        'Switched to existing worktree slot "' +
        slot +
        '".\n' +
        '  branch: ' +
        wt.branch +
        '\n' +
        '  path:   ' +
        wt.path,
    };
  }

  const cwd = ctx.cwdRealpath || ctx.cwd || process.cwd();
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    return {
      ok: false,
      text: 'Not a git repository. enter_worktree requires --cwd to be inside a git repo.',
    };
  }

  saveRepoRoot(ctx, cwd, repoRoot);

  const suffix = sanitizeBranchSuffix(args && args.branch) || makeBranchSuffix();
  const branch = BRANCH_PREFIX + suffix;
  const wtId = suffix.replace(/[^a-zA-Z0-9._-]/g, '-');
  const wtPath = path.join(ensureWorktreeDir(), wtId);

  if (fs.existsSync(wtPath)) {
    return { ok: false, text: 'Worktree path already exists: ' + wtPath };
  }

  try {
    git(['worktree', 'add', '-b', branch, wtPath, 'HEAD'], repoRoot);
  } catch (err) {
    return {
      ok: false,
      text: 'Failed to create worktree: ' + (err.stderr || err.message).toString().trim(),
    };
  }

  ctx.worktrees[slot] = {
    path: wtPath,
    branch,
    repoRoot,
    slot,
    description: String((args && args.description) || '').slice(0, 200),
    enteredAt: Date.now(),
  };
  activateSlot(ctx, slot);

  return {
    ok: true,
    text:
      'Entered worktree slot "' +
      slot +
      '".\n' +
      '  branch: ' +
      branch +
      '\n' +
      '  path:   ' +
      wtPath +
      '\n' +
      '  repo:   ' +
      repoRoot +
      '\n' +
      'Use another slot for parallel isolation, or exit_worktree when done.',
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'enter_worktree', category: 'worktree' },
};
