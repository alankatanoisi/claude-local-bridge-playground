'use strict';

/**
 * WP2 core — the immutable per-run authority ceiling.
 *
 * Monotonicity contract: nothing after run start (ctx mutation, hook, child
 * spawn) can raise authority above the CLI-derived ceiling. Narrowing is fine.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createAuthorityCeiling,
  effectiveFlags,
  toolAboveCeiling,
  planCeilingBlocksForce,
  narrowChildAuthority,
} = require('../../src/runner/authority');
const permissions = require('../../src/runner/permissions');
const { executeForce } = require('../../src/runner/tool-registry');

function freshDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('authority ceiling — construction', () => {
  it('freezes the ceiling and its tools set', () => {
    const ceiling = createAuthorityCeiling({
      allowShell: true,
      plan: false,
      noNetwork: true,
      _cliToolAllowlist: new Set(['read_file']),
    });
    assert.equal(Object.isFrozen(ceiling), true);
    assert.equal(Object.isFrozen(ceiling.tools), true);
    assert.equal(ceiling.allowShell, true);
    assert.equal(ceiling.noNetwork, true);
    assert.deepEqual([...ceiling.tools], ['read_file']);
  });

  it('null tools ceiling means "no CLI allowlist", not "everything"', () => {
    const ceiling = createAuthorityCeiling({ allowShell: false });
    assert.equal(ceiling.tools, null);
    assert.equal(toolAboveCeiling('bash', { authorityCeiling: ceiling }), false);
  });
});

describe('authority ceiling — effective flags clamp ctx mutations', () => {
  it('mid-run allowShell mutation cannot widen above the ceiling', () => {
    const ceiling = createAuthorityCeiling({ allowShell: false });
    const ctx = { allowShell: true, authorityCeiling: ceiling }; // hostile mutation
    assert.equal(effectiveFlags(ctx).allowShell, false);
  });

  it('plan and noNetwork are one-way restrictions', () => {
    const ceiling = createAuthorityCeiling({ plan: true, noNetwork: true });
    const ctx = { plan: false, noNetwork: false, authorityCeiling: ceiling };
    const eff = effectiveFlags(ctx);
    assert.equal(eff.plan, true);
    assert.equal(eff.noNetwork, true);
  });

  it('narrowing below the ceiling is allowed', () => {
    const ceiling = createAuthorityCeiling({ allowShell: true });
    const ctx = { allowShell: false, authorityCeiling: ceiling };
    assert.equal(effectiveFlags(ctx).allowShell, false);
  });
});

describe('authority ceiling — permission gate enforcement', () => {
  const cwd = '/fake/project';

  it('shell stays denied when ctx.allowShell is mutated above a shell-less ceiling', () => {
    const ceiling = createAuthorityCeiling({ allowShell: false });
    const result = permissions.check('bash', { command: 'ls' }, { cwd, allowShell: true, authorityCeiling: ceiling });
    assert.equal(result.decision, 'deny');
    assert.ok(result.reason.includes('--allow-shell'));
  });

  it('plan-ceiling runs stay in plan mode even when ctx.plan is flipped off', () => {
    const ceiling = createAuthorityCeiling({ plan: true });
    const result = permissions.check(
      'write_file',
      { path: 'a.txt', content: 'x' },
      { cwd, plan: false, acceptEdits: true, dontAsk: true, authorityCeiling: ceiling },
    );
    assert.equal(result.mode, 'plan');
    assert.equal(result.decision, 'ask');
    assert.ok(result.proposedAction.includes('(plan mode)'));
  });

  it('tools outside the --tools ceiling are hard-denied even if allowedTools is mutated', () => {
    const ceiling = createAuthorityCeiling({ _cliToolAllowlist: new Set(['read_file']) });
    const ctx = {
      cwd,
      // hostile widening: allowedTools re-computed to include write_file
      allowedTools: new Set(['read_file', 'write_file']),
      authorityCeiling: ceiling,
    };
    const result = permissions.check('write_file', { path: 'a.txt', content: 'x' }, ctx);
    assert.equal(result.decision, 'deny');
    assert.equal(result.ruleId, 'authority_ceiling');
    assert.equal(result.severity, 'hard_deny');
  });
});

describe('authority ceiling — force execution under plan', () => {
  it('planCeilingBlocksForce blocks effectful categories only', () => {
    const ctx = { authorityCeiling: createAuthorityCeiling({ plan: true }) };
    assert.equal(planCeilingBlocksForce('write_file', 'write', ctx), true);
    assert.equal(planCeilingBlocksForce('bash', 'shell', ctx), true);
    assert.equal(planCeilingBlocksForce('undo', 'recovery', ctx), true);
    assert.equal(planCeilingBlocksForce('read_file', 'read-only', ctx), false);
  });

  it('executeForce refuses to write under a plan ceiling (closes the historical bypass)', async () => {
    const tmpDir = freshDir('ceiling-force-');
    const ctx = {
      cwd: tmpDir,
      cwdRealpath: fs.realpathSync(tmpDir),
      plan: true,
      authorityCeiling: createAuthorityCeiling({ plan: true }),
    };
    const result = await executeForce('write_file', { path: 'x.txt', content: 'nope' }, ctx, 'tu1');
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('authority ceiling'));
    assert.equal(fs.existsSync(path.join(tmpDir, 'x.txt')), false);
  });
});

describe('authority ceiling — child narrowing', () => {
  it('children intersect flags and tools with the parent ceiling', () => {
    const parent = createAuthorityCeiling({
      allowShell: false,
      _cliToolAllowlist: new Set(['read_file', 'list_files']),
    });
    const child = narrowChildAuthority(parent, {
      allowShell: true,
      acceptEdits: true,
      dontAsk: true,
      tools: ['read_file', 'write_file', 'bash'],
    });
    assert.equal(child.allowShell, false);
    assert.deepEqual(child.tools, ['read_file']);
  });

  it('plan-ceiling parents never hand children edit automation', () => {
    const parent = createAuthorityCeiling({ plan: true, allowShell: true });
    const child = narrowChildAuthority(parent, { allowShell: true, acceptEdits: true, dontAsk: true, tools: null });
    assert.equal(child.allowShell, true, 'shell inherits the explicit parent ceiling');
    assert.equal(child.acceptEdits, false);
    assert.equal(child.dontAsk, false);
  });

  it('no parent ceiling passes the request through unchanged', () => {
    const child = narrowChildAuthority(null, { allowShell: true, acceptEdits: false, dontAsk: true, tools: ['a'] });
    assert.deepEqual(child, { allowShell: true, acceptEdits: false, dontAsk: true, tools: ['a'] });
  });
});
