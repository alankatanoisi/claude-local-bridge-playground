'use strict';

/**
 * worktree-utils.js — Shared git worktree helpers for enter/exit/list tools.
 */

const { execFileSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

const BRANCH_PREFIX = 'bridge-runner/';
const MAX_BRANCH_LEN = 60;
const DEFAULT_SLOT = 'default';

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
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_BRANCH_LEN);
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

function normalizeSlot(raw) {
  const slot = String(raw || DEFAULT_SLOT)
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 40);
  return slot || DEFAULT_SLOT;
}

function ensureWorktreeState(ctx) {
  if (!ctx.worktrees || typeof ctx.worktrees !== 'object') ctx.worktrees = {};
}

function saveRepoRoot(ctx, cwd, repoRoot) {
  if (!ctx.worktreeRepoRoot) {
    ctx.worktreeRepoRoot = {
      cwd,
      cwdRealpath: ctx.cwdRealpath || cwd,
      repoRoot,
    };
  }
}

function syncWorktreeAlias(ctx) {
  ensureWorktreeState(ctx);
  if (ctx.activeWorktreeSlot && ctx.worktrees[ctx.activeWorktreeSlot]) {
    ctx.worktree = ctx.worktrees[ctx.activeWorktreeSlot];
  } else {
    delete ctx.worktree;
  }
}

function activateSlot(ctx, slot) {
  ensureWorktreeState(ctx);
  const entry = ctx.worktrees[slot];
  if (!entry) return false;
  ctx.activeWorktreeSlot = slot;
  ctx.cwd = entry.path;
  ctx.cwdRealpath = entry.path;
  syncWorktreeAlias(ctx);
  return true;
}

function deactivateToRepoRoot(ctx) {
  if (ctx.worktreeRepoRoot) {
    ctx.cwd = ctx.worktreeRepoRoot.cwd;
    ctx.cwdRealpath = ctx.worktreeRepoRoot.cwdRealpath;
  }
  ctx.activeWorktreeSlot = null;
  syncWorktreeAlias(ctx);
}

function listRegisteredWorktrees(ctx) {
  ensureWorktreeState(ctx);
  return Object.entries(ctx.worktrees).map(([slot, wt]) => ({
    slot,
    active: slot === ctx.activeWorktreeSlot,
    branch: wt.branch,
    path: wt.path,
    description: wt.description || '',
    enteredAt: wt.enteredAt,
  }));
}

function scanOrphanWorktreeDirs() {
  const root = worktreeRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
}

module.exports = {
  BRANCH_PREFIX,
  DEFAULT_SLOT,
  git,
  sanitizeBranchSuffix,
  makeBranchSuffix,
  worktreeRoot,
  findRepoRoot,
  ensureWorktreeDir,
  normalizeSlot,
  ensureWorktreeState,
  saveRepoRoot,
  syncWorktreeAlias,
  activateSlot,
  deactivateToRepoRoot,
  listRegisteredWorktrees,
  scanOrphanWorktreeDirs,
};
