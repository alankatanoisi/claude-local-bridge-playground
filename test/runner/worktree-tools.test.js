'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const enterWorktree = require('../../src/runner/tools/enter-worktree');
const exitWorktree = require('../../src/runner/tools/exit-worktree');
const { getDefinitions } = require('../../src/runner/tool-registry');
const permissions = require('../../src/runner/permissions');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('worktree tools — visibility', () => {
  it('enter/exit/list worktree are visible at top level', () => {
    const defs = getDefinitions({ spawnDepth: 0, cwd: '/tmp', cwdRealpath: '/tmp' });
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('enter_worktree'));
    assert.ok(names.includes('exit_worktree'));
    assert.ok(names.includes('list_worktrees'));
  });
});

describe('worktree tools — permissions', () => {
  it('ask by default', () => {
    const d = permissions.check('enter_worktree', {}, { spawnDepth: 0, cwd: '/tmp', cwdRealpath: '/tmp' });
    assert.equal(d.decision, 'ask');
  });

  it('allow with acceptEdits', () => {
    const d = permissions.check(
      'exit_worktree',
      { cleanup: true },
      { spawnDepth: 0, acceptEdits: true, cwd: '/tmp', cwdRealpath: '/tmp' },
    );
    assert.equal(d.decision, 'allow');
  });

  it('plan mode surfaces a plan-mode explanation (decision is ask, ruleId mode_policy)', () => {
    const d = permissions.check('enter_worktree', {}, { spawnDepth: 0, plan: true, cwd: '/tmp', cwdRealpath: '/tmp' });
    assert.equal(d.decision, 'ask');
    assert.equal(d.ruleId, 'mode_policy');
    assert.match(d.explanation, /Plan mode/i);
  });
});

describe('worktree tools — enter/exit lifecycle', () => {
  it('rejects when not a git repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notgit-'));
    const result = enterWorktree.execute({}, { cwd: dir, cwdRealpath: dir });
    assert.equal(result.ok, false);
    assert.match(result.text, /git repository/i);
  });

  it('rejects creating a second slot when path already exists on disk', () => {
    const ctx = {
      cwd: '/tmp',
      cwdRealpath: '/tmp',
      worktrees: { default: { path: '/x' } },
      activeWorktreeSlot: 'default',
    };
    const result = enterWorktree.execute({ slot: 'other', branch: 'new' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /git repository|Failed to create worktree/i);
  });

  it('rejects exit for unknown slot', () => {
    const result = exitWorktree.execute({}, { cwd: '/tmp', cwdRealpath: '/tmp', worktrees: {} });
    assert.equal(result.ok, false);
    assert.match(result.text, /No worktree slot/i);
  });

  it('switches to an existing slot instead of failing', () => {
    const ctx = {
      cwd: '/tmp/a',
      cwdRealpath: '/tmp/a',
      worktrees: {
        alpha: { path: '/tmp/wt-alpha', branch: 'bridge-runner/alpha', repoRoot: '/tmp/repo' },
      },
      activeWorktreeSlot: null,
      worktreeRepoRoot: { cwd: '/tmp/a', cwdRealpath: '/tmp/a', repoRoot: '/tmp/repo' },
    };
    const result = enterWorktree.execute({ slot: 'alpha' }, ctx);
    assert.equal(result.ok, true);
    assert.match(result.text, /Switched to existing/);
    assert.equal(ctx.activeWorktreeSlot, 'alpha');
    assert.equal(ctx.cwd, '/tmp/wt-alpha');
  });

  it('supports parallel slots in one run', () => {
    const repo = tmpRepo();
    const originalCwd = fs.realpathSync(repo);
    const ctx = { cwd: originalCwd, cwdRealpath: originalCwd };

    const a = enterWorktree.execute({ slot: 'a', branch: 'slot-a' }, ctx);
    assert.equal(a.ok, true);
    const pathA = ctx.worktrees.a.path;

    const b = enterWorktree.execute({ slot: 'b', branch: 'slot-b' }, ctx);
    assert.equal(b.ok, true);
    assert.notEqual(ctx.worktrees.a.path, ctx.worktrees.b.path);
    assert.equal(ctx.activeWorktreeSlot, 'b');

    enterWorktree.execute({ slot: 'a' }, ctx);
    assert.equal(ctx.cwd, pathA);

    exitWorktree.execute({ slot: 'b', cleanup: true }, ctx);
    exitWorktree.execute({ slot: 'a', cleanup: true }, ctx);
    assert.equal(Object.keys(ctx.worktrees).length, 0);
  });

  it('creates a worktree, switches cwd, then restores on exit', () => {
    const repo = tmpRepo();
    const originalCwd = fs.realpathSync(repo);
    const ctx = { cwd: originalCwd, cwdRealpath: originalCwd };

    const entered = enterWorktree.execute({ branch: 'test-branch', description: 'unit test' }, ctx);
    assert.equal(entered.ok, true);
    assert.match(entered.text, /bridge-runner\/test-branch/);
    assert.ok(ctx.worktrees.default);
    assert.ok(fs.existsSync(ctx.worktrees.default.path));
    assert.equal(ctx.cwd, ctx.worktrees.default.path);
    assert.equal(ctx.cwdRealpath, ctx.worktrees.default.path);

    // README exists in the worktree
    assert.ok(fs.existsSync(path.join(ctx.worktrees.default.path, 'README.md')));

    const wtPath = ctx.worktrees.default.path;
    const exited = exitWorktree.execute({ cleanup: true }, ctx);
    assert.equal(exited.ok, true);
    assert.match(exited.text, /Exited worktree/);
    assert.equal(ctx.cwd, originalCwd);
    assert.equal(ctx.cwdRealpath, originalCwd);
    assert.equal(ctx.worktrees.default, undefined);
    assert.ok(!fs.existsSync(wtPath), 'worktree directory removed after cleanup');
  });

  it('exit without cleanup keeps the worktree', () => {
    const repo = tmpRepo();
    const originalCwd = fs.realpathSync(repo);
    const ctx = { cwd: originalCwd, cwdRealpath: originalCwd };

    enterWorktree.execute({ branch: 'keep-me' }, ctx);
    const wtPath = ctx.worktrees.default.path;
    exitWorktree.execute({}, ctx);
    assert.ok(fs.existsSync(wtPath), 'worktree kept when cleanup=false');
    // manual cleanup for test hygiene
    try {
      execFileSync('git', ['worktree', 'remove', '--force', wtPath], { cwd: originalCwd });
      execFileSync('git', ['branch', '-D', 'bridge-runner/keep-me'], { cwd: originalCwd });
    } catch {
      // best effort
    }
  });

  it('sanitizes branch names', () => {
    const repo = tmpRepo();
    const originalCwd = fs.realpathSync(repo);
    const ctx = { cwd: originalCwd, cwdRealpath: originalCwd };

    const entered = enterWorktree.execute({ branch: 'bad chars!; rm -rf /' }, ctx);
    assert.equal(entered.ok, true);
    assert.match(entered.text, /bridge-runner\/bad-chars-rm-rf/);
    // cleanup
    exitWorktree.execute({ cleanup: true }, ctx);
  });
});
