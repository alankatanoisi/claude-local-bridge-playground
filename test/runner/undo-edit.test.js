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

  it('reports a clear error when there is no undo entry', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-edit-empty-'));
    const result = undoEdit.execute({ path: 'missing.txt' }, { cwd: tmpDir, undoLog: [] });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('No undo entry'));
  });
});
