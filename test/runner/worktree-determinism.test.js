'use strict';

/**
 * worktree-determinism.test.js — deterministic worktree isolation (2026-08-07).
 *
 * Three defenses, all HARNESS-enforced (never model discretion):
 *   D1 --worktree startup flag  — the runner enters a fresh worktree before any
 *                                 model request (exercised via the real CLI in WD-6).
 *   D2 git consent gate         — git commit/push/checkout/switch/merge always
 *                                 ask, in every mode, unbypassable by automation flags.
 *   D3 shell root-confinement   — while a worktree is active, bash referencing the
 *                                 original checkout path is hard-denied.
 *
 * Context: forensics showed prompt-level "enter a worktree" is advisory — agents
 * called enter_worktree then bash-escaped back into the main checkout, and
 * automation flags let history-mutating git run without a fresh confirmation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const permissions = require('../../src/runner/permissions');
const shellPolicy = require('../../src/runner/shell-policy');

function makeCtx(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-'));
  return { tmp, ctx: { cwd: tmp, cwdRealpath: fs.realpathSync(tmp), allowShell: true, ...extra } };
}

describe('WD-2/D2 git consent gate', () => {
  const GIT_STATE_COMMANDS = [
    'git commit -m "x"',
    'git push origin main',
    'git checkout -b feature',
    'git switch main',
    'git merge foo',
    'git -C /some/path commit -m y', // global option before the verb
    'git --no-pager checkout main',
  ];

  it('WD-1: every history-mutating git verb asks, even under --accept-edits --dont-ask', () => {
    const { ctx } = makeCtx({ acceptEdits: true, dontAsk: true });
    for (const command of GIT_STATE_COMMANDS) {
      const decision = permissions.check('bash', { command }, ctx);
      assert.equal(decision.decision, 'ask', command + ' must ask');
      assert.equal(decision.ruleId, 'git_consent', command + ' must be gated by git_consent');
      assert.match(String(decision.proposedAction), /repository-history action/i);
    }
  });

  it('WD-2: read-only git verbs stay allowed under --dont-ask', () => {
    const { ctx } = makeCtx({ dontAsk: true });
    for (const command of ['git status', 'git log --oneline', 'git diff HEAD', 'git show', 'git branch --list']) {
      const decision = permissions.check('bash', { command }, ctx);
      assert.equal(decision.decision, 'allow', command + ' should not trigger git consent');
    }
  });

  it('WD-3: non-git commands are unaffected by the git gate', () => {
    const { ctx } = makeCtx({ dontAsk: true });
    const decision = permissions.check('bash', { command: 'echo hello' }, ctx);
    assert.equal(decision.decision, 'allow');
  });

  it('WD-5: git consent fires in every mode combination (sweep)', () => {
    for (const flags of [{}, { acceptEdits: true }, { dontAsk: true }, { acceptEdits: true, dontAsk: true }]) {
      const { ctx } = makeCtx({ allowShell: true, ...flags });
      const decision = permissions.check('bash', { command: 'git push' }, ctx);
      assert.equal(decision.decision, 'ask', 'git push must ask under ' + JSON.stringify(flags));
    }
  });

  it('WD-5b: without --allow-shell, bash git is denied (shell gate wins over the git ask)', () => {
    // The git consent gate lives BEHIND the shell-enabled check: a no-shell run
    // denies bash outright (ruleId shell_disabled), it does not "ask" about the
    // git verb inside it. (shell_disabled is a bypassable_deny, not hard_deny —
    // --allow-shell is the intended bypass; we assert the ruleId, not hardness.)
    const { ctx } = makeCtx({ allowShell: false, dontAsk: true });
    const decision = permissions.check('bash', { command: 'git push' }, ctx);
    assert.equal(decision.decision, 'deny');
    assert.equal(decision.ruleId, 'shell_disabled');
    assert.notEqual(decision.ruleId, 'git_consent', 'must not reach the git ask on a no-shell run');
  });

  it('WD-5c: detectGitStateChange finds the verb, tolerating global options and chained commands', () => {
    assert.equal(shellPolicy.detectGitStateChange('git commit -m x'), 'commit');
    assert.equal(shellPolicy.detectGitStateChange('git -C /p push'), 'push');
    assert.equal(shellPolicy.detectGitStateChange('cd sub && git switch main'), 'switch', 'chained git must match');
    assert.equal(shellPolicy.detectGitStateChange('git status'), null);
    assert.equal(shellPolicy.detectGitStateChange('ls -la'), null);
    // Conservative by design: a git verb appearing anywhere triggers the ask.
    // Over-triggering (e.g. inside `echo`) is safe; silently allowing is not.
    assert.equal(shellPolicy.detectGitStateChange('echo git commit'), 'commit', 'over-trigger is the safe default');
  });
});

describe('WD-4/D3 shell root-confinement', () => {
  function activeWorktreeCtx() {
    const orig = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-orig-'));
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-wt-'));
    return {
      orig,
      ctx: {
        cwd: wt,
        cwdRealpath: fs.realpathSync(wt),
        allowShell: true,
        dontAsk: true,
        activeWorktreeSlot: 'default',
        worktreeRepoRoot: { repoRoot: orig, cwd: orig, cwdRealpath: fs.realpathSync(orig) },
      },
    };
  }

  it('WD-4: bash referencing the original checkout is hard-denied while a worktree is active', () => {
    const { orig, ctx } = activeWorktreeCtx();
    // NB: a neutral basename on purpose — a name like "secrets.txt" would trip
    // the generic deny matrix first and mask the confinement rule under test.
    const decision = permissions.check('bash', { command: 'cat ' + path.join(orig, 'notes.txt') }, ctx);
    assert.equal(decision.decision, 'deny');
    assert.equal(decision.ruleId, 'worktree_confinement');
    assert.equal(permissions.isHardDeny(decision), true);
  });

  it('WD-4b: the same command is allowed when NO worktree is active', () => {
    const orig = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-orig2-'));
    const { ctx } = makeCtx({ dontAsk: true });
    const decision = permissions.check('bash', { command: 'echo ' + path.join(orig, 'file.txt') }, ctx);
    assert.equal(decision.decision, 'allow', 'no active worktree → no confinement');
  });

  it('WD-4c: commands staying inside the worktree are unaffected', () => {
    const { ctx } = activeWorktreeCtx();
    const decision = permissions.check('bash', { command: 'cat ' + path.join(ctx.cwd, 'file.txt') }, ctx);
    // Inside-worktree path is fine; only a git verb or a real block would change this.
    assert.equal(decision.decision, 'allow');
  });

  it('WD-4d: detectWorktreeEscape returns the matched root, or null when inactive', () => {
    const { orig, ctx } = activeWorktreeCtx();
    assert.equal(shellPolicy.detectWorktreeEscape('ls ' + orig, ctx), orig);
    assert.equal(shellPolicy.detectWorktreeEscape('ls ' + orig, { ...ctx, activeWorktreeSlot: null }), null);
  });
});

// ── D1: real-CLI startup entry (FG-E style, spawns the actual runner) ──
const RUNNER_BIN = path.join(__dirname, '..', '..', 'bin', 'local-bridge-runner.js');

function gitInit(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'init'], {
    cwd: dir,
  });
}

function runCli(args, cwd, tmpHome) {
  const env = { ...process.env };
  delete env.BRIDGE_RUNNER_TEST;
  delete env.BRIDGE_RUNNER_ARCHIVE;
  env.HOME = tmpHome;
  env.BRIDGE_RUNNER_BRIDGE_URL = 'http://127.0.0.1:9'; // dead port: tripwire for "reached transport"
  const r = spawnSync(process.execPath, [RUNNER_BIN, ...args], { cwd, env, encoding: 'utf8', timeout: 30000 });
  return { ...r, combined: String(r.stdout || '') + String(r.stderr || '') };
}

describe('WD-6/D1 --worktree startup entry (real CLI)', () => {
  it('WD-6: in a git repo, --worktree enters a worktree BEFORE transport, then fails on the dead bridge', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cli-repo-'));
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cli-home-'));
    gitInit(cwd);

    const r = runCli(['--worktree', '--trust-workspace', 'hello'], cwd, tmpHome);
    assert.notEqual(r.status, 0, 'dead bridge must still fail the run');
    assert.match(r.combined, /--worktree:/, 'must log the worktree entry marker; got: ' + r.combined.slice(0, 500));
    assert.doesNotMatch(r.combined, /not a git repo|worktree could not/i, 'entry should have succeeded');
    // Ordering proof: the failure is transport-shaped, i.e. entry happened first.
    assert.match(r.combined, /bridge|connect|ECONNREFUSED|network/i, 'expected a transport error after entry');
    // A worktree directory now exists under the isolated HOME.
    const wtRoot = path.join(tmpHome, '.bridge-runner', 'worktrees');
    assert.ok(fs.existsSync(wtRoot) && fs.readdirSync(wtRoot).length >= 1, 'a worktree dir must have been created');
  });

  it('WD-6b: in a NON-git directory, --worktree fails closed BEFORE transport', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cli-nogit-'));
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-cli-home2-'));

    const r = runCli(['--worktree', '--trust-workspace', 'hello'], cwd, tmpHome);
    assert.notEqual(r.status, 0, 'non-git + --worktree must refuse to run');
    assert.match(r.combined, /worktree could not|not a git repo/i, 'must explain the isolation failure');
    // Fail-closed ordering: it must NOT have reached the bridge.
    assert.doesNotMatch(r.combined, /ECONNREFUSED|connect ECONN/i, 'must fail before transport');
  });
});
