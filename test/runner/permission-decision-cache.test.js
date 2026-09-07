'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const permissions = require('../../src/runner/permissions');

function freshCtx(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'permcache-' + label + '-'));
  return { cwd: tmp, cwdRealpath: fs.realpathSync(tmp), acceptEdits: true, dontAsk: true };
}

describe('Ext-8 permission decision cache', () => {
  it('caches an allow decision for the same (tool, args, ctx) tuple', () => {
    const ctx = freshCtx('allow');
    fs.writeFileSync(path.join(ctx.cwd, 'a.txt'), 'x');
    const a = permissions.check('read_file', { path: 'a.txt' }, ctx);
    assert.equal(a.decision, 'allow');
    const b = permissions.check('read_file', { path: 'a.txt' }, ctx);
    assert.equal(a, b, 'returned the same cached object identity');
  });

  it('does NOT cache ask decisions', () => {
    const ctx = { ...freshCtx('ask'), acceptEdits: false };
    fs.writeFileSync(path.join(ctx.cwd, 'a.txt'), 'x');
    const a = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctx);
    assert.equal(a.decision, 'ask');
    const b = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctx);
    assert.notEqual(a, b, 'ask decisions are recomputed every call');
  });

  it('invalidateDecisionCache(ctx, [path]) drops matching entries', () => {
    const ctx = freshCtx('invalidate');
    fs.writeFileSync(path.join(ctx.cwd, 'a.txt'), 'x');
    fs.writeFileSync(path.join(ctx.cwd, 'b.txt'), 'y');
    const a1 = permissions.check('read_file', { path: 'a.txt' }, ctx);
    const b1 = permissions.check('read_file', { path: 'b.txt' }, ctx);
    permissions.invalidateDecisionCache(ctx, ['a.txt']);
    const a2 = permissions.check('read_file', { path: 'a.txt' }, ctx);
    const b2 = permissions.check('read_file', { path: 'b.txt' }, ctx);
    assert.notEqual(a1, a2, 'a was invalidated');
    assert.equal(b1, b2, 'b remained cached');
  });

  it('P0-10: cached allow under root A does not auto-allow after the root moves to B', () => {
    const wt = require('../../src/runner/worktree-utils');
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'permcache-rootA-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'permcache-rootB-'));
    fs.writeFileSync(path.join(rootA, 'a.txt'), 'root A content');
    fs.writeFileSync(path.join(rootB, 'a.txt'), 'root B content');

    const ctx = { cwd: rootA, cwdRealpath: fs.realpathSync(rootA), acceptEdits: true };
    const d1 = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctx);
    assert.equal(d1.decision, 'allow');
    const d2 = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctx);
    assert.equal(d1, d2, 'second check under root A hits the cache');

    // Move the root using the real worktree transition functions, which
    // mutate this same ctx object (that in-place mutation is the whole bug).
    wt.saveRepoRoot(ctx, ctx.cwd, ctx.cwd);
    wt.ensureWorktreeState(ctx);
    ctx.worktrees.other = { path: rootB, branch: 'test-branch' };
    assert.equal(wt.activateSlot(ctx, 'other'), true);

    const d3 = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctx);
    assert.notEqual(d3, d1, 'root B decision is freshly computed, not the root A cache entry');

    // Returning to root A bumps the epoch again — root A's old entries stay dead.
    wt.deactivateToRepoRoot(ctx);
    const d4 = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctx);
    assert.notEqual(d4, d1, 'old root A entries are not resurrected after returning');
  });

  it('different ctx flags produce different cache entries', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'permcache-flags-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x');
    const ctxA = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp), acceptEdits: true };
    const ctxB = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp), acceptEdits: false };
    const dA = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctxA);
    const dB = permissions.check('write_file', { path: 'a.txt', content: 'y' }, ctxB);
    assert.equal(dA.decision, 'allow');
    assert.equal(dB.decision, 'ask', 'different flags → different decision');
  });
});

// A context is reused during a run. Tightening its policy must take effect even
// when exactly the same tool request was allowed and cached earlier.
describe('permission cache respects policy narrowing', () => {
  const { createAuthorityCeiling } = require('../../src/runner/authority');
  const registry = require('../../src/runner/tool-registry');

  function narrowingCtx(t, initial = {}) {
    const ctx = { ...freshCtx('narrowing'), allowShell: true, ...initial };
    ctx.authorityCeiling = createAuthorityCeiling(ctx);
    t.after(() => fs.rmSync(ctx.cwd, { recursive: true, force: true }));
    return ctx;
  }

  it('rechecks a cached write after plan mode is enabled', async (t) => {
    const ctx = narrowingCtx(t);
    const args = { path: 'sentinel.txt', content: 'temporary test fixture' };
    assert.equal(permissions.check('write_file', args, ctx).decision, 'allow');

    // Warm the real cache before changing the SAME context object.
    ctx.plan = true;
    const result = await registry.execute('write_file', args, ctx, 'cache-plan-test');
    assert.equal(fs.existsSync(path.join(ctx.cwd, args.path)), false, 'plan mode must prevent the write');
    assert.equal(result.needsConfirmation, true);
    assert.equal(permissions.check('write_file', args, ctx).decision, 'ask');
  });

  it('rechecks a cached network command after noNetwork is enabled', (t) => {
    const ctx = narrowingCtx(t);
    // Classify this string only: the test never runs curl or accesses a network.
    const args = { command: 'curl https://example.com' };
    assert.equal(permissions.check('bash', args, ctx).decision, 'allow');
    ctx.noNetwork = true;
    assert.equal(permissions.check('bash', args, ctx).decision, 'deny');
  });

  it('keeps the startup network restriction when its mutable flag is cleared', (t) => {
    const ctx = narrowingCtx(t, { noNetwork: true });
    const args = { command: 'curl https://example.com' };
    const denied = permissions.check('bash', args, ctx);
    assert.equal(denied.decision, 'deny');
    ctx.noNetwork = false;
    assert.equal(permissions.check('bash', args, ctx).decision, 'deny');
  });
});
