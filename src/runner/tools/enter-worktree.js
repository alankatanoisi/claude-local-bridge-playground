'use strict';

/**
 * enter_worktree — create an isolated git worktree on a fresh branch and
 * switch the runner's cwd into it. All subsequent tool calls operate inside
 * the worktree until exit_worktree is called.
 *
 * Safety:
 * - Branch name is sanitized and prefixed with bridge-runner/.
 * - Worktree path lives under ~/.bridge-runner/worktrees/<id>/ (outside the
 *   repo, so it doesn't pollute the working tree as untracked files).
 * - Only one worktree active per run (ctx.worktree).
 * - No shell interpolation: git is invoked via execFileSync with arg arrays.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const BRANCH_PREFIX = 'bridge-runner/';
const MAX_BRANCH_LEN = 60;

function definition() {
  return {
    name: 'enter_worktree',
    description:
      'Create an isolated git worktree on a fresh branch and switch the runner into it. ' +
      'Subsequent tools operate inside the worktree until exit_worktree. ' +
      'Requires the cwd to be a git repository.',
    input_schema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'Optional branch name suffix (sanitized). Defaults to a generated id.',
        },
        description: {
          type: 'string',
          description: 'Optional short description recorded on ctx.worktree for logging.',
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

function sanitizeBranchSuffix(raw) {
  const base = String(raw || '').trim();
  if (!base) return null;
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, '-') // no slashes — avoid invalid git branch names
    .replace(/-{2,}/g, '-') // collapse runs of dashes
    .replace(/^[-._]+|[-._]+$/g, ''); // strip leading/trailing separators
  if (!cleaned) return null;
  const sliced = cleaned.slice(0, MAX_BRANCH_LEN);
  return sliced;
}

function makeBranchSuffix() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const rand = crypto.randomBytes(3).toString('hex');
  return stamp + '-' + rand;
}

function worktreeRoot() {
  const home = process.env.HOME || process.env.USERPROFILE || os.tmpdir();
  return path.join(home, '.bridge-runner', 'worktrees');
}

function findRepoRoot(cwd) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    return null;
  }
}

function ensureWorktreeDir() {
  const dir = worktreeRoot();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function execute(args, ctx) {
  if (ctx.worktree) {
    return {
      ok: false,
      text: 'A worktree is already active for this run. Call exit_worktree first.',
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

  const originalCwd = ctx.cwd;
  const originalCwdRealpath = ctx.cwdRealpath;
  ctx.worktree = {
    path: wtPath,
    branch,
    repoRoot,
    originalCwd,
    originalCwdRealpath,
    description: String((args && args.description) || '').slice(0, 200),
    enteredAt: Date.now(),
  };
  ctx.cwd = wtPath;
  ctx.cwdRealpath = wtPath;

  return {
    ok: true,
    text:
      'Entered worktree.\n' +
      '  branch: ' +
      branch +
      '\n' +
      '  path:   ' +
      wtPath +
      '\n' +
      '  repo:   ' +
      repoRoot +
      '\n' +
      'All subsequent tools operate inside the worktree. Call exit_worktree to return.',
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'enter_worktree', category: 'worktree' },
};
