'use strict';

/**
 * P1-01 — plan-mode proposal recorder.
 *
 * The key round-trip property: a diff proposed in plan mode must apply
 * cleanly through this repo's own apply_patch hunk engine, producing exactly
 * the content the plan promised.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildPlanProposal, buildUnifiedDiff } = require('../../src/runner/plan-proposals');
const applyPatch = require('../../src/runner/tools/apply-patch');

function freshCtx(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { cwd: dir, cwdRealpath: fs.realpathSync(dir), dir };
}

/** Apply a proposal diff with the real apply_patch engine (executeForce path). */
async function applyProposal(ctx, relPath, diff) {
  const result = await applyPatch.execute(
    { path: relPath, patch_text: diff },
    { ...ctx, acceptEdits: true, dontAsk: true },
  );
  return result;
}

describe('buildUnifiedDiff', () => {
  it('returns null for identical content', () => {
    assert.equal(buildUnifiedDiff('a\nb\n', 'a\nb\n', 'f.txt'), null);
  });

  it('produces a single hunk with correct counts', () => {
    const diff = buildUnifiedDiff('one\ntwo\nthree\nfour\n', 'one\nTWO\nthree\nfour\n', 'f.txt');
    assert.ok(diff.includes('--- a/f.txt'));
    assert.ok(diff.includes('+++ b/f.txt'));
    assert.ok(/@@ -\d+,\d+ \+\d+,\d+ @@/.test(diff));
    assert.ok(diff.includes('-two'));
    assert.ok(diff.includes('+TWO'));
  });
});

describe('plan proposal round-trips through apply_patch', () => {
  it('edit_file proposal applies cleanly and matches the materialized edit', async () => {
    const ctx = freshCtx('planprop-edit-');
    const original = 'alpha\nbeta\ngamma\ndelta\n';
    fs.writeFileSync(path.join(ctx.dir, 'notes.txt'), original);

    const proposal = buildPlanProposal(
      'edit_file',
      { path: 'notes.txt', old_string: 'gamma', new_string: 'GAMMA\nGAMMA2' },
      ctx,
      'Edit notes.txt',
    );
    assert.equal(proposal.kind, 'diff');

    const applied = await applyProposal(ctx, 'notes.txt', proposal.diff);
    assert.equal(applied.ok, true, applied.text);
    assert.equal(fs.readFileSync(path.join(ctx.dir, 'notes.txt'), 'utf8'), 'alpha\nbeta\nGAMMA\nGAMMA2\ndelta\n');
  });

  it('write_file overwrite proposal applies cleanly', async () => {
    const ctx = freshCtx('planprop-write-');
    fs.writeFileSync(path.join(ctx.dir, 'config.txt'), 'k=1\nother=2\n');

    const proposal = buildPlanProposal(
      'write_file',
      { path: 'config.txt', content: 'k=9\nother=2\nadded=3\n' },
      ctx,
      'Write config.txt',
    );
    assert.equal(proposal.kind, 'diff');

    const applied = await applyProposal(ctx, 'config.txt', proposal.diff);
    assert.equal(applied.ok, true, applied.text);
    assert.equal(fs.readFileSync(path.join(ctx.dir, 'config.txt'), 'utf8'), 'k=9\nother=2\nadded=3\n');
  });

  it('edit at the very start and very end of the file both apply', async () => {
    const ctx = freshCtx('planprop-ends-');
    fs.writeFileSync(path.join(ctx.dir, 'f.txt'), 'first\nmid\nlast\n');

    const startProposal = buildPlanProposal(
      'edit_file',
      { path: 'f.txt', old_string: 'first', new_string: 'FIRST' },
      ctx,
      'x',
    );
    const appliedStart = await applyProposal(ctx, 'f.txt', startProposal.diff);
    assert.equal(appliedStart.ok, true, appliedStart.text);

    const endProposal = buildPlanProposal(
      'edit_file',
      { path: 'f.txt', old_string: 'last', new_string: 'LAST' },
      ctx,
      'x',
    );
    const appliedEnd = await applyProposal(ctx, 'f.txt', endProposal.diff);
    assert.equal(appliedEnd.ok, true, appliedEnd.text);
    assert.equal(fs.readFileSync(path.join(ctx.dir, 'f.txt'), 'utf8'), 'FIRST\nmid\nLAST\n');
  });
});

describe('plan proposal shapes', () => {
  it('new file → content preview, not a diff', () => {
    const ctx = freshCtx('planprop-new-');
    const proposal = buildPlanProposal('write_file', { path: 'new.txt', content: 'hello\n' }, ctx, 'x');
    assert.equal(proposal.kind, 'new_file');
    assert.ok(proposal.text.includes('NOT created'));
    assert.ok(proposal.text.includes('hello'));
  });

  it('invalid edit surfaces the real matching error', () => {
    const ctx = freshCtx('planprop-bad-');
    fs.writeFileSync(path.join(ctx.dir, 'f.txt'), 'abc\n');
    const proposal = buildPlanProposal('edit_file', { path: 'f.txt', old_string: 'zzz', new_string: 'y' }, ctx, 'x');
    assert.equal(proposal.kind, 'invalid');
    assert.ok(proposal.text.includes('old_string not found'));
  });

  it('non-file effects fall back to the honest one-line description', () => {
    const ctx = freshCtx('planprop-shell-');
    const proposal = buildPlanProposal('bash', { command: 'rm -rf /' }, ctx, 'Run: rm -rf /');
    assert.equal(proposal.kind, 'described');
    assert.equal(proposal.text, 'Plan mode: would Run: rm -rf /');
  });

  it('path escapes are refused', () => {
    const ctx = freshCtx('planprop-escape-');
    const proposal = buildPlanProposal(
      'edit_file',
      { path: '../outside.txt', old_string: 'a', new_string: 'b' },
      ctx,
      'x',
    );
    assert.equal(proposal.kind, 'invalid');
    assert.ok(proposal.text.includes('escapes working directory'));
  });
});
