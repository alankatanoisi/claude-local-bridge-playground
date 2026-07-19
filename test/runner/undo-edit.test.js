'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const editFile = require('../../src/runner/tools/edit-file');
const undoEdit = require('../../src/runner/tools/undo-edit');

describe('undo_edit tool', () => {
  it('restores a previous edit by tool_use_id', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-edit-'));
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'before\n');
    const ctx = { cwd: tmpDir, undoLog: [], toolUseId: 'tu1' };

    const edit = editFile.execute({ path: 'file.txt', old_string: 'before', new_string: 'after' }, ctx);
    assert.equal(edit.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'after\n');

    const undo = undoEdit.execute({ tool_use_id: 'tu1' }, ctx);
    assert.equal(undo.ok, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'before\n');
  });

  it('P0-10: refuses to restore when the working root changed since the edit', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-rootA-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-rootB-'));
    const fileA = path.join(rootA, 'file.txt');
    const fileB = path.join(rootB, 'file.txt');
    fs.writeFileSync(fileA, 'before\n');
    // Same relative name exists in the new root — the file undo must NOT touch.
    fs.writeFileSync(fileB, 'unrelated content in new root\n');

    const ctx = { cwd: rootA, undoLog: [], toolUseId: 'tu1' };
    const edit = editFile.execute({ path: 'file.txt', old_string: 'before', new_string: 'after' }, ctx);
    assert.equal(edit.ok, true);

    // Simulate a worktree transition: the root moves, same ctx object.
    ctx.cwd = rootB;
    ctx.cwdRealpath = fs.realpathSync(rootB);
    ctx.rootEpoch = 1;

    const undo = undoEdit.execute({ tool_use_id: 'tu1' }, ctx);
    assert.equal(undo.ok, false, 'undo refuses after a root change');
    assert.ok(undo.text.includes('working root changed'), 'error explains the root change');
    assert.equal(fs.readFileSync(fileA, 'utf8'), 'after\n', 'old-root file untouched');
    assert.equal(fs.readFileSync(fileB, 'utf8'), 'unrelated content in new root\n', 'new-root file untouched');
  });

  it('P0-10: restore target equals the confined path, not a stale absolute path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-confined-'));
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'before\n');
    const ctx = { cwd: tmpDir, undoLog: [], toolUseId: 'tu1' };

    const edit = editFile.execute({ path: 'file.txt', old_string: 'before', new_string: 'after' }, ctx);
    assert.equal(edit.ok, true);

    // Tamper with the recorded absolute path (points somewhere else entirely).
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-elsewhere-'));
    ctx.undoLog[0].absolute_path = path.join(elsewhere, 'file.txt');

    const undo = undoEdit.execute({ tool_use_id: 'tu1' }, ctx);
    assert.equal(undo.ok, false, 'mismatched absolute_path is refused, never written');
    assert.ok(!fs.existsSync(path.join(elsewhere, 'file.txt')), 'nothing written at the stale absolute path');
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'after\n');
  });

  it('reports a clear error when there is no undo entry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-edit-empty-'));
    const result = undoEdit.execute({ path: 'missing.txt' }, { cwd: tmpDir, undoLog: [] });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('No undo entry'));
  });
});
