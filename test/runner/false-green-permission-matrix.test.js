'use strict';

/**
 * false-green-permission-matrix.test.js — whole-catalog permission sweeps (FG-B).
 *
 * The existing permissions tests pin single tools ("edit_file asks", "bash is
 * denied"). None of them quantify over EVERY registered tool, so a brand-new
 * tool added with the wrong category — or a MODES table edit that flips one
 * cell — can leave the whole suite green while the runner's authority story
 * changes. These sweeps iterate the real catalog, so future tools are inside
 * the net the moment they register.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const permissions = require('../../src/runner/permissions');
const { CATEGORIES, VALID_CATEGORIES, TOOLS } = require('../../src/runner/tool-catalog');
const { createAuthorityCeiling, narrowChildAuthority, EFFECTFUL_CATEGORIES } = require('../../src/runner/authority');
const { validateChaosCombo } = require('../../src/runner/shell-policy');
const safety = require('../../src/runner/safety');

function makeCtx(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-perm-'));
  return { tmp, ctx: { cwd: tmp, cwdRealpath: fs.realpathSync(tmp), ...extra } };
}

describe('FG-B MODES table shape invariants', () => {
  it('FG-B1: every mode defines a decision for every valid category', () => {
    // `rule[category] || 'deny'` fails closed today, but an explicit table hole
    // is still a smell: it means nobody decided. Force the decision.
    for (const [mode, rules] of Object.entries(permissions.MODES)) {
      for (const category of VALID_CATEGORIES) {
        assert.ok(
          ['allow', 'ask', 'deny', 'plan_only'].includes(rules[category]),
          'MODES.' + mode + '.' + category + ' must be an explicit decision, got: ' + rules[category],
        );
      }
    }
  });

  it('FG-B2: write is never auto-allowed by a mode that lacks acceptEdits', () => {
    // The CLAUDE.md invariant "--dont-ask must not enable writes by itself"
    // lives in one table cell. Guard the cell, not just one tool's behavior.
    for (const mode of ['default', 'dontAsk', 'plan']) {
      assert.notEqual(permissions.MODES[mode].write, 'allow', 'MODES.' + mode + '.write must not be allow');
    }
  });

  it('FG-B3: plan mode keeps every effectful category at plan_only', () => {
    for (const category of EFFECTFUL_CATEGORIES) {
      assert.equal(permissions.MODES.plan[category], 'plan_only', 'plan mode must keep ' + category + ' at plan_only');
    }
  });
});

describe('FG-B whole-catalog decision sweeps', () => {
  it('FG-B4: in default mode, no effectful tool is auto-allowed', () => {
    // Iterates the REAL catalog: a new tool registered tomorrow with
    // category write/shell/orchestration/worktree is covered automatically.
    const { ctx } = makeCtx();
    for (const [name, category] of Object.entries(CATEGORIES)) {
      if (!EFFECTFUL_CATEGORIES.has(category) || category === 'recovery') continue;
      const decision = permissions.check(name, {}, ctx);
      assert.notEqual(decision.decision, 'allow', name + ' (' + category + ') must not auto-allow in default mode');
    }
  });

  it('FG-B5: every shell-category tool is denied without allowShell, in every non-shell mode', () => {
    // Generic over future shell tools: isBaseEligible hardcodes bash and
    // manage_shell_jobs by NAME, so a new shell-category tool would dodge that
    // check — the category gate here is the backstop that must hold.
    for (const flags of [{}, { dontAsk: true }, { acceptEdits: true }, { acceptEdits: true, dontAsk: true }]) {
      const { ctx } = makeCtx(flags);
      for (const [name, category] of Object.entries(CATEGORIES)) {
        if (category !== 'shell') continue;
        const decision = permissions.check(name, {}, ctx);
        assert.equal(
          decision.decision,
          'deny',
          name + ' must be denied without allowShell under flags ' + JSON.stringify(flags),
        );
      }
    }
  });

  it('FG-B6: write-category tools stay at ask under dontAsk-only', () => {
    const { ctx } = makeCtx({ dontAsk: true });
    for (const [name, category] of Object.entries(CATEGORIES)) {
      if (category !== 'write') continue;
      const decision = permissions.check(name, {}, ctx);
      assert.equal(decision.decision, 'ask', name + ' must still ask under --dont-ask alone');
    }
  });

  it('FG-B7: destructive worktree cleanup asks in every mode, even acceptEdits+dontAsk', () => {
    // P0-07: no flag combo may imply consent to branch deletion.
    for (const flags of [{}, { acceptEdits: true }, { dontAsk: true }, { acceptEdits: true, dontAsk: true }]) {
      const { ctx } = makeCtx(flags);
      const decision = permissions.check('exit_worktree', { cleanup: true }, ctx);
      assert.equal(decision.decision, 'ask', 'cleanup must ask under ' + JSON.stringify(flags));
      assert.match(String(decision.proposedAction), /DESTRUCTIVE/i, 'confirmation copy must say DESTRUCTIVE');
    }
  });

  it('FG-B8: unknown tools are a hard deny that survives force execution', () => {
    const { ctx } = makeCtx({ acceptEdits: true, dontAsk: true });
    const decision = permissions.check('totally_new_unregistered_tool', {}, ctx);
    assert.equal(decision.decision, 'deny');
    assert.equal(permissions.isHardDeny(decision), true, 'unknown tool must be hard_deny');
  });

  it('FG-B9: spawn_agent is denied for children regardless of automation flags', () => {
    const { ctx } = makeCtx({ acceptEdits: true, dontAsk: true, spawnDepth: 1 });
    const decision = permissions.check('spawn_agent', {}, ctx);
    assert.equal(decision.decision, 'deny', 'child agents must not spawn grandchildren');
  });
});

describe('FG-B authority ceiling clamps', () => {
  it('FG-B10: a mid-run allowShell escalation is clamped to the ceiling', () => {
    // Simulates a hook/bug/hostile mutation flipping ctx.allowShell after the
    // run started without shell consent. The ceiling must win.
    const { ctx } = makeCtx();
    ctx.authorityCeiling = createAuthorityCeiling({ allowShell: false });
    ctx.allowShell = true; // hostile/buggy mid-run mutation
    ctx.dontAsk = true;
    const decision = permissions.check('bash', { command: 'echo hi' }, ctx);
    assert.equal(decision.decision, 'deny', 'ceiling must clamp mid-run allowShell=true');
  });

  it('FG-B11: plan is one-way — clearing ctx.plan cannot leave plan mode', () => {
    const { ctx } = makeCtx();
    ctx.authorityCeiling = createAuthorityCeiling({ plan: true });
    ctx.plan = false; // attempt to escape plan mode mid-run
    const decision = permissions.check('write_file', { path: 'a.txt', content: 'x' }, ctx);
    assert.equal(decision.decision, 'ask');
    assert.match(String(decision.proposedAction), /\(plan mode\)/, 'must still be a plan-mode dry-run ask');
  });

  it('FG-B12: a --tools ceiling hard-denies everything outside the allowlist', () => {
    const { ctx } = makeCtx({ acceptEdits: true, dontAsk: true });
    ctx.authorityCeiling = createAuthorityCeiling({ _cliToolAllowlist: new Set(['read_file']) });
    const denied = permissions.check('write_file', { path: 'a.txt', content: 'x' }, ctx);
    assert.equal(denied.decision, 'deny');
    assert.equal(permissions.isHardDeny(denied), true, '--tools ceiling must be hard_deny');
    const allowed = permissions.check('read_file', { path: 'a.txt' }, ctx);
    assert.equal(allowed.decision, 'allow');
  });

  it('FG-B13: children of a plan-ceiling parent can never receive automation flags', () => {
    const parent = createAuthorityCeiling({ plan: true, allowShell: true });
    const child = narrowChildAuthority(parent, { acceptEdits: true, dontAsk: true, allowShell: true });
    assert.equal(child.acceptEdits, false, 'plan parent must strip child acceptEdits');
    assert.equal(child.dontAsk, false, 'plan parent must strip child dontAsk');
    // allowShell may pass through only because the parent ceiling had it.
    assert.equal(child.allowShell, true);
  });

  it('FG-B14: child tool requests are intersected with the parent tools ceiling', () => {
    const parent = createAuthorityCeiling({ _cliToolAllowlist: new Set(['read_file', 'glob']) });
    const child = narrowChildAuthority(parent, { tools: ['read_file', 'bash', 'write_file'] });
    assert.deepEqual(child.tools, ['read_file'], 'child tools must be parent∩requested');
  });

  it('FG-B15: the chaos flag combo still requires --chaos-ok', () => {
    const blocked = validateChaosCombo({ allowShell: true, acceptEdits: true, dontAsk: true, chaosOk: false });
    assert.equal(blocked.allowed, false);
    const allowed = validateChaosCombo({ allowShell: true, acceptEdits: true, dontAsk: true, chaosOk: true });
    assert.equal(allowed.allowed, true);
  });
});

describe('FG-B decision-cache staleness contracts', () => {
  it('FG-B16: root transitions invalidate cached decisions only via rootEpoch — and the bump works', () => {
    // Two roots: in A, ok.txt is a plain file; in B, ok.txt is a symlink to a
    // file OUTSIDE B. The same (tool, args) pair must flip allow → deny when
    // the root changes. The runner's contract is: every root transition bumps
    // ctx.rootEpoch. Both halves are asserted so a future "optimization" that
    // stops bumping the epoch fails the second half.
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-epoch-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-epoch-b-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-epoch-out-'));
    fs.writeFileSync(path.join(rootA, 'ok.txt'), 'plain\n');
    fs.writeFileSync(path.join(outside, 'target.txt'), 'outside\n');
    fs.symlinkSync(path.join(outside, 'target.txt'), path.join(rootB, 'ok.txt'));

    const ctx = { cwd: rootA, cwdRealpath: fs.realpathSync(rootA), rootEpoch: 0 };
    assert.equal(permissions.check('read_file', { path: 'ok.txt' }, ctx).decision, 'allow');

    // Root transition WITHOUT the epoch bump: the cache serves the stale
    // allow. This assertion documents WHY the bump is mandatory — if the
    // cache implementation changes to key on cwd directly, this flips and the
    // test should be updated to the stronger behavior.
    ctx.cwd = rootB;
    ctx.cwdRealpath = fs.realpathSync(rootB);
    assert.equal(
      permissions.check('read_file', { path: 'ok.txt' }, ctx).decision,
      'allow',
      'documents the stale-cache hazard the rootEpoch contract exists to fix',
    );

    // With the bump (what enter/exit_worktree actually do), the fresh check
    // sees the symlink escape and denies.
    ctx.rootEpoch = 1;
    const fresh = permissions.check('read_file', { path: 'ok.txt' }, ctx);
    assert.equal(fresh.decision, 'deny', 'epoch bump must retire old-root cache entries');
  });

  it('FG-B17: invalidateDecisionCache + realpath invalidation pick up an in-place symlink swap', () => {
    // TOCTOU shape: a path is checked (allow cached), then swapped for a
    // symlink to an outside file. The documented contract is that successful
    // writes invalidate both caches for that path; verify invalidation
    // actually restores a correct deny.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-swap-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-swap-out-'));
    fs.writeFileSync(path.join(root, 'ok.txt'), 'plain\n');
    fs.writeFileSync(path.join(outside, 'loot.txt'), 'outside\n');

    const ctx = { cwd: root, cwdRealpath: fs.realpathSync(root), rootEpoch: 0 };
    assert.equal(permissions.check('read_file', { path: 'ok.txt' }, ctx).decision, 'allow');

    fs.rmSync(path.join(root, 'ok.txt'));
    fs.symlinkSync(path.join(outside, 'loot.txt'), path.join(root, 'ok.txt'));

    permissions.invalidateDecisionCache(ctx, ['ok.txt']);
    safety.invalidateRealpathCache(ctx); // clear-all: the swap changed the world

    const fresh = permissions.check('read_file', { path: 'ok.txt' }, ctx);
    assert.equal(fresh.decision, 'deny', 'post-invalidation check must see the symlink escape');
  });
});

describe('FG-B gate coverage of non-"path" argument keys', () => {
  it('FG-B18: a deny-listed target under file_path is denied for every catalogued write tool that accepts it', () => {
    // Complements the N1 contract test with the write-tool slice: the gate
    // must inspect ALL catalogued path keys on effectful tools specifically.
    const { ctx } = makeCtx({ acceptEdits: true });
    for (const [name] of Object.entries(TOOLS)) {
      if (CATEGORIES[name] !== 'write') continue;
      const decision = permissions.check(name, { path: '.env', content: 'x', new_string: 'x', old_string: 'y' }, ctx);
      assert.equal(decision.decision, 'deny', name + ' must deny .env even with acceptEdits');
      assert.equal(decision.severity, 'hard_deny', name + ' .env deny must be hard');
    }
  });
});

describe('FG-B whole-runner effectiveFlags(ctx) enforcement (no raw ceiling-flag reads)', () => {
  // FG-B19 shares the real lint configuration. A syntax tree sees dot reads,
  // bracket reads, and destructuring as code instead of guessing from text.
  // Separate negative examples in authority-flag-lint.test.js prove the rule
  // rejects each spelling and keeps the two narrow exemptions constrained.
  it('FG-B19: no module under src/runner reads raw ceiling flags for behavior', async () => {
    const { ESLint } = require('eslint');
    const repo = path.resolve(__dirname, '../..');
    const eslint = new ESLint({ cwd: repo, overrideConfigFile: path.join(repo, 'eslint.config.cjs') });
    const results = await eslint.lintFiles(['src/runner/**/*.js']);
    const offenders = results.flatMap((result) =>
      result.messages
        .filter((message) => message.fatal || message.ruleId === 'runner/no-raw-authority-flags')
        .map((message) => `${path.relative(process.cwd(), result.filePath)}:${message.line} ${message.message}`),
    );
    assert.deepEqual(offenders, [], 'Raw ceiling-flag reads found:\n' + offenders.join('\n'));
  });

  it('FG-B20: mid-run allowShell=true cannot enable test-watcher shell execution or run during plan ceiling', () => {
    const watcher = require('../../src/runner/test-watcher');
    const { tmp, ctx } = makeCtx({ allowShell: false, testWatch: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { test: 'echo should-not-run' } }));
    ctx.authorityCeiling = createAuthorityCeiling({ allowShell: false, plan: false });
    ctx.allowShell = true; // hostile/buggy mid-run escalation

    assert.equal(watcher.isWatchEnabled(ctx), false, 'ceiling allowShell:false must keep test-watcher off');
    assert.equal(watcher.runIfEnabled(ctx).ran, false, 'test-watcher must not spawn shell without startup consent');

    const planCtx = {
      cwd: tmp,
      cwdRealpath: fs.realpathSync(tmp),
      allowShell: true,
      plan: true,
      testWatch: true,
    };
    planCtx.authorityCeiling = createAuthorityCeiling(planCtx);
    planCtx.plan = false; // attempt to escape plan mode mid-run
    assert.equal(watcher.isWatchEnabled(planCtx), false, 'plan ceiling must block post-write test execution');
  });

  it('FG-B21: mid-run allowShell=true or allowedTools wipe cannot widen tool visibility above the ceiling', () => {
    const { isToolVisible } = require('../../src/runner/tool-visibility');
    const { ctx } = makeCtx({ allowShell: false });
    ctx.authorityCeiling = createAuthorityCeiling({
      allowShell: false,
      _cliToolAllowlist: new Set(['read_file']),
    });
    ctx.allowShell = true; // mid-run escalation attempt
    ctx.allowedTools = null; // attempt to drop --tools allowlist

    assert.equal(isToolVisible('bash', ctx), false, 'bash must stay invisible under allowShell:false ceiling');
    assert.equal(
      isToolVisible('list_files', ctx),
      false,
      'list_files must stay invisible outside the startup --tools ceiling',
    );
    assert.equal(isToolVisible('read_file', ctx), true, 'read_file inside --tools ceiling remains visible');
  });

  it('FG-B22: clearing ctx.plan mid-run cannot let askUserQuestion bypass plan-mode refusal', () => {
    const { askUserQuestion } = require('../../src/runner/user-question');
    const { ctx } = makeCtx({ plan: true });
    ctx.authorityCeiling = createAuthorityCeiling(ctx);
    ctx.plan = false; // mid-run escape attempt

    const res = askUserQuestion({ question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }, ctx);
    assert.equal(res.ok, false);
    assert.match(res.text, /^Plan mode:/, 'askUserQuestion must still enforce the startup plan ceiling');
  });

  it('FG-B23: clearing ctx.plan mid-run in tool-pipeline still records plan proposals without prompting or writing', async () => {
    const { createToolPipeline } = require('../../src/runner/tool-pipeline');
    const { tmp, ctx } = makeCtx({
      plan: true,
      enabledCapabilities: new Set(['edits']),
      planProposals: [],
    });
    ctx.authorityCeiling = createAuthorityCeiling(ctx);

    let confirmCalled = false;
    const pipeline = createToolPipeline({
      ctx,
      runId: 'fg-b23-plan-ceiling',
      confirm: {
        ask: async () => {
          confirmCalled = true;
          return 'allow';
        },
      },
      sinks: {},
    });
    pipeline.toolDefinitions(); // snapshot offered tools for this turn
    ctx.plan = false; // mid-run attempt to drop out of plan mode

    const turn = await pipeline.executeTurn(1, [
      { id: 'tu_plan_1', name: 'write_file', input: { path: 'escaped.txt', content: 'nope\n' } },
    ]);

    assert.equal(confirmCalled, false, 'plan ceiling must record a proposal, never call confirm.ask');
    assert.equal(fs.existsSync(path.join(tmp, 'escaped.txt')), false, 'plan ceiling must never write to disk');
    assert.equal(ctx.planProposals.length, 1, 'write must be recorded in ctx.planProposals');
    assert.match(String(turn.toolResults[0].content), /Plan mode:/);
  });
});
