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
  it('enter/exit worktree are visible at top level', () => {
    const defs = getDefinitions({ spawnDepth: 0, cwd: '/tmp', cwdRealpath: '/tmp' });
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('enter_worktree'));
    assert.ok(names.includes('exit_worktree'));
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

  it('rejects double enter', () => {
    const ctx = { cwd: '/tmp', cwdRealpath: '/tmp', worktree: { path: '/x' } };
    const result = enterWorktree.execute({}, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /already active/i);
  });

  it('rejects exit without active worktree', () => {
    const result = exitWorktree.execute({}, { cwd: '/tmp', cwdRealpath: '/tmp' });
    assert.equal(result.ok, false);
    assert.match(result.text, /No worktree is active/i);
  });

  it('creates a worktree, switches cwd, then restores on exit', () => {
    const repo = tmpRepo();
    const originalCwd = fs.realpathSync(repo);
    const ctx = { cwd: originalCwd, cwdRealpath: originalCwd };

    const entered = enterWorktree.execute({ branch: 'test-branch', description: 'unit test' }, ctx);
    assert.equal(entered.ok, true);
    assert.match(entered.text, /bridge-runner\/test-branch/);
    assert.ok(ctx.worktree);
    assert.ok(fs.existsSync(ctx.worktree.path));
    assert.equal(ctx.cwd, ctx.worktree.path);
    assert.equal(ctx.cwdRealpath, ctx.worktree.path);
    assert.equal(ctx.worktree.originalCwd, originalCwd);

    // README exists in the worktree
    assert.ok(fs.existsSync(path.join(ctx.worktree.path, 'README.md')));

    const wtPath = ctx.worktree.path;
    const exited = exitWorktree.execute({ cleanup: true }, ctx);
    assert.equal(exited.ok, true);
    assert.match(exited.text, /Exited worktree/);
    assert.equal(ctx.cwd, originalCwd);
    assert.equal(ctx.cwdRealpath, originalCwd);
    assert.equal(ctx.worktree, undefined);
    assert.ok(!fs.existsSync(wtPath), 'worktree directory removed after cleanup');
  });

  it('exit without cleanup keeps the worktree', () => {
    const repo = tmpRepo();
    const originalCwd = fs.realpathSync(repo);
    const ctx = { cwd: originalCwd, cwdRealpath: originalCwd };

    enterWorktree.execute({ branch: 'keep-me' }, ctx);
    const wtPath = ctx.worktree.path;
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
