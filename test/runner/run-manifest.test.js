'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { execute: editFile } = require('../../src/runner/tools/edit-file');
const { execute: writeFile } = require('../../src/runner/tools/write-file');
const {
  writeRunManifest,
  listRunManifests,
  latestRunManifest,
  resolveRunManifest,
  planRevert,
  applyRevert,
} = require('../../src/runner/recovery/run-manifest');

// Each test gets a throwaway project folder so backups/manifests stay isolated.
function freshRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-manifest-'));
}

describe('run manifest (recovery workflow)', () => {
  it('writes a manifest from the undo log and lists it', () => {
    const cwd = freshRepo();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\n');
    const ctx = { cwd, undoLog: [] };
    editFile({ path: 'a.txt', old_string: 'one', new_string: 'two' }, ctx);

    const written = writeRunManifest(cwd, {
      runId: 'run-A',
      sessionId: 'ses-1',
      model: 'm',
      startedAt: 't0',
      undoLog: ctx.undoLog,
    });
    assert.ok(written && fs.existsSync(written));

    const runs = listRunManifests(cwd);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'run-A');
    assert.equal(runs[0].sessionId, 'ses-1');
    assert.equal(runs[0].edits.length, 1);
    assert.equal(runs[0].edits[0].path, 'a.txt');
  });

  it('returns null (no manifest) for a read-only run', () => {
    const cwd = freshRepo();
    const written = writeRunManifest(cwd, { runId: 'run-empty', undoLog: [] });
    assert.equal(written, null);
    assert.equal(listRunManifests(cwd).length, 0);
  });

  it('resolves a run by session id and by run-id prefix', () => {
    const cwd = freshRepo();
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\n');
    const ctx = { cwd, undoLog: [] };
    editFile({ path: 'a.txt', old_string: 'one', new_string: 'two' }, ctx);
    writeRunManifest(cwd, { runId: 'run-XYZ-123', sessionId: 'ses-7', undoLog: ctx.undoLog });

    assert.equal(resolveRunManifest(cwd, 'ses-7').runId, 'run-XYZ-123');
    assert.equal(resolveRunManifest(cwd, 'run-XYZ').runId, 'run-XYZ-123'); // prefix
    assert.equal(resolveRunManifest(cwd, 'nope'), null);
  });

  it('reverts a single edit back to the original content', () => {
    const cwd = freshRepo();
    const file = path.join(cwd, 'a.txt');
    fs.writeFileSync(file, 'original\n');
    const ctx = { cwd, undoLog: [] };
    editFile({ path: 'a.txt', old_string: 'original', new_string: 'changed' }, ctx);
    assert.equal(fs.readFileSync(file, 'utf8'), 'changed\n');

    writeRunManifest(cwd, { runId: 'run-rev', undoLog: ctx.undoLog });
    const plan = planRevert(cwd, latestRunManifest(cwd));
    assert.equal(plan.actions[0].status, 'restore');

    const results = applyRevert(cwd, plan, {});
    assert.equal(results[0].applied, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'original\n');
  });

  it('walks multiple edits to the same file back to the pre-run state', () => {
    const cwd = freshRepo();
    const file = path.join(cwd, 'a.txt');
    fs.writeFileSync(file, 'v0\n');
    const ctx = { cwd, undoLog: [] };
    editFile({ path: 'a.txt', old_string: 'v0', new_string: 'v1' }, ctx);
    editFile({ path: 'a.txt', old_string: 'v1', new_string: 'v2' }, ctx);
    assert.equal(fs.readFileSync(file, 'utf8'), 'v2\n');

    writeRunManifest(cwd, { runId: 'run-multi', undoLog: ctx.undoLog });
    const plan = planRevert(cwd, latestRunManifest(cwd));
    applyRevert(cwd, plan, {});
    assert.equal(fs.readFileSync(file, 'utf8'), 'v0\n');
  });

  it('deletes a file the run created when reverting', () => {
    const cwd = freshRepo();
    const file = path.join(cwd, 'new.txt');
    const ctx = { cwd, undoLog: [] };
    writeFile({ path: 'new.txt', content: 'brand new\n' }, ctx);
    assert.ok(fs.existsSync(file));

    writeRunManifest(cwd, { runId: 'run-create', undoLog: ctx.undoLog });
    const plan = planRevert(cwd, latestRunManifest(cwd));
    assert.equal(plan.actions[0].status, 'delete');

    applyRevert(cwd, plan, {});
    assert.equal(fs.existsSync(file), false);
  });

  it('skips a diverged file unless --force is passed', () => {
    const cwd = freshRepo();
    const file = path.join(cwd, 'a.txt');
    fs.writeFileSync(file, 'original\n');
    const ctx = { cwd, undoLog: [] };
    editFile({ path: 'a.txt', old_string: 'original', new_string: 'changed' }, ctx);
    writeRunManifest(cwd, { runId: 'run-div', undoLog: ctx.undoLog });

    // A later edit (or manual change) makes the file diverge from what the run wrote.
    fs.writeFileSync(file, 'someone-else-changed-this\n');

    const plan = planRevert(cwd, latestRunManifest(cwd));
    assert.equal(plan.actions[0].status, 'diverged');

    // Default: leave the newer content alone.
    const skipped = applyRevert(cwd, plan, {});
    assert.equal(skipped[0].applied, false);
    assert.equal(skipped[0].skipped, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'someone-else-changed-this\n');

    // Forced: overwrite back to the pre-run content.
    const forced = applyRevert(cwd, plan, { force: true });
    assert.equal(forced[0].applied, true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'original\n');
  });

  it('marks an edit whose file vanished as gone', () => {
    const cwd = freshRepo();
    const file = path.join(cwd, 'a.txt');
    fs.writeFileSync(file, 'original\n');
    const ctx = { cwd, undoLog: [] };
    editFile({ path: 'a.txt', old_string: 'original', new_string: 'changed' }, ctx);
    writeRunManifest(cwd, { runId: 'run-gone', undoLog: ctx.undoLog });

    fs.unlinkSync(file);
    const plan = planRevert(cwd, latestRunManifest(cwd));
    assert.equal(plan.actions[0].status, 'gone');
    const results = applyRevert(cwd, plan, {});
    assert.equal(results[0].applied, false);
  });
});
