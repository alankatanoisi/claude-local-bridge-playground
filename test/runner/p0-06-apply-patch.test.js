'use strict';

/**
 * P0-06 — repaired apply_patch: no shell, full hunk validation, atomic write, rollback.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const applyPatch = require('../../src/runner/tools/apply-patch');
const { QUARANTINED_TOOLS } = require('../../src/runner/tool-catalog');
const { isToolVisible, computeAllowedTools } = require('../../src/runner/tool-visibility');
const { execute, executeForce, getDefinitions, snapshotOfferedTools } = require('../../src/runner/tool-registry');

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apply-patch-'));
}

function writeProjectFile(root, rel, body) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, 'utf8');
  return abs;
}

describe('apply_patch repair (P0-06)', () => {
  it('is no longer quarantined; still hidden unless named in --tools', () => {
    assert.ok(!QUARANTINED_TOOLS.has('apply_patch'));
    const ctx = { allowShell: false, enableLsp: false, spawnDepth: 0 };
    assert.equal(isToolVisible('apply_patch', ctx), false);

    const allowed = computeAllowedTools({
      ...ctx,
      _cliToolAllowlist: new Set(['read_file', 'apply_patch']),
    });
    assert.ok(allowed.has('apply_patch'));
    assert.equal(isToolVisible('apply_patch', { ...ctx, allowedTools: allowed }), true);
  });

  it('applies a single hunk with atomic write and backup', () => {
    const root = tempProject();
    writeProjectFile(root, 'a.txt', 'alpha\nbeta\ngamma\n');
    const patch = '--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n';
    const result = applyPatch.execute(
      { path: 'a.txt', patch_text: patch },
      { cwd: root, cwdRealpath: root, undoLog: [] },
    );
    assert.equal(result.ok, true, result.text);
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'alpha\nBETA\ngamma\n');
    assert.match(result.text, /Backup:/);
    assert.ok(fs.existsSync(path.join(root, '.bridge-runner', 'backups')));
  });

  it('applies multiple hunks and validates every one', () => {
    const root = tempProject();
    writeProjectFile(root, 'm.txt', 'one\ntwo\nthree\nfour\n');
    const patch = '@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n@@ -3,2 +3,2 @@\n three\n-four\n+FOUR\n';
    const result = applyPatch.execute({ path: 'm.txt', patch_text: patch }, { cwd: root, cwdRealpath: root });
    assert.equal(result.ok, true, result.text);
    assert.equal(fs.readFileSync(path.join(root, 'm.txt'), 'utf8'), 'ONE\ntwo\nthree\nFOUR\n');
  });

  it('refuses a context mismatch without modifying the file', () => {
    const root = tempProject();
    const abs = writeProjectFile(root, 'bad.txt', 'hello\nworld\n');
    const before = fs.readFileSync(abs, 'utf8');
    const patch = '@@ -1,2 +1,2 @@\n-HELLO\n+hi\n world\n';
    const result = applyPatch.execute({ path: 'bad.txt', patch_text: patch }, { cwd: root, cwdRealpath: root });
    assert.equal(result.ok, false);
    assert.match(result.text, /context mismatch/i);
    assert.equal(fs.readFileSync(abs, 'utf8'), before);
  });

  it('never invokes a shell for metacharacter filenames', () => {
    const root = tempProject();
    // Filename that would be dangerous under shell interpolation.
    const rel = 'evil$(uname).txt';
    writeProjectFile(root, rel, 'safe\n');
    const patch = '@@ -1 +1 @@\n-safe\n+SAFE\n';
    const result = applyPatch.execute({ path: rel, patch_text: patch }, { cwd: root, cwdRealpath: root });
    assert.equal(result.ok, true, result.text);
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), 'SAFE\n');
  });

  it('honors expected_sha256', () => {
    const root = tempProject();
    writeProjectFile(root, 'h.txt', 'x\n');
    const patch = '@@ -1 +1 @@\n-x\n+y\n';
    const result = applyPatch.execute(
      { path: 'h.txt', patch_text: patch, expected_sha256: 'deadbeef' },
      { cwd: root, cwdRealpath: root },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /expected_sha256/i);
    assert.equal(fs.readFileSync(path.join(root, 'h.txt'), 'utf8'), 'x\n');
  });

  it('rejects path escape', () => {
    const root = tempProject();
    const result = applyPatch.execute(
      { path: '../outside.txt', patch_text: '@@ -1 +1 @@\n-a\n+b\n' },
      { cwd: root, cwdRealpath: root },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /escapes working directory/i);
  });

  it('rejects hunk old-count mismatch at parse time', () => {
    const parsed = applyPatch._parseUnifiedHunks('@@ -1,2 +1,1 @@\n-onlyone\n');
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /old-count mismatch/i);
  });

  it('is offered when named in --tools and executes via registry', async () => {
    const root = tempProject();
    writeProjectFile(root, 'r.txt', 'a\n');
    const ctx = {
      cwd: root,
      cwdRealpath: root,
      allowShell: false,
      enableLsp: false,
      spawnDepth: 0,
      acceptEdits: true,
      _cliToolAllowlist: new Set(['apply_patch']),
      undoLog: [],
    };
    const allowed = computeAllowedTools(ctx);
    ctx.allowedTools = allowed;
    snapshotOfferedTools(ctx, getDefinitions(ctx));
    assert.ok(ctx.offeredTools.has('apply_patch'));

    const result = await execute('apply_patch', { path: 'r.txt', patch_text: '@@ -1 +1 @@\n-a\n+b\n' }, ctx);
    assert.equal(result.ok, true, result.text);
    assert.equal(fs.readFileSync(path.join(root, 'r.txt'), 'utf8'), 'b\n');
  });

  it('executeForce works when offered (no longer quarantined)', async () => {
    const root = tempProject();
    writeProjectFile(root, 'f.txt', 'z\n');
    const ctx = {
      cwd: root,
      cwdRealpath: root,
      acceptEdits: true,
      dontAsk: true,
      offeredTools: new Set(['apply_patch']),
      undoLog: [],
    };
    const result = await executeForce('apply_patch', { path: 'f.txt', patch_text: '@@ -1 +1 @@\n-z\n+Z\n' }, ctx);
    assert.equal(result.ok, true, result.text);
  });
});
