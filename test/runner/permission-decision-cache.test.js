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
