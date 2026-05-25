'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const delta = require('../../src/runner/instruction-delta');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'instr-delta-' + label + '-'));
}

describe('Ext-11 instruction-delta', () => {
  beforeEach(() => {
    delta.reset();
  });

  it('returns null when nothing has changed since snapshot', () => {
    const cwd = tmp('unchanged');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v1\n');
    delta.snapshot(cwd);
    assert.equal(delta.detectChange(cwd), null);
  });

  it('returns unsnapshotted when snapshot() was never called', () => {
    const cwd = tmp('nosnap');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v1\n');
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'unsnapshotted');
  });

  it('returns a small_diff with added/removed lines and a deltaBlock', () => {
    const cwd = tmp('small');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'line a\nline b\nline c\n');
    delta.snapshot(cwd);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'line a\nline b modified\nline c\nline d\n');
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'small_diff');
    assert.deepEqual(r.added.sort(), ['line b modified', 'line d'].sort());
    assert.deepEqual(r.removed, ['line b']);
    assert.match(r.deltaBlock, /Instruction memory update/);
    assert.match(r.deltaBlock, /\+ line d/);
    assert.match(r.deltaBlock, /- line b/);
  });

  it('returns large_rewrite when the diff exceeds the threshold', () => {
    const cwd = tmp('large');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'short\n');
    delta.snapshot(cwd);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'huge content\n'.repeat(1000));
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'large_rewrite');
    assert.ok(r.sizeAfter > r.sizeBefore);
  });

  it('advances the snapshot after a detected change', () => {
    const cwd = tmp('advance');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v1\n');
    delta.snapshot(cwd);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v2\n');
    const first = delta.detectChange(cwd);
    assert.ok(first);
    const second = delta.detectChange(cwd);
    assert.equal(second, null, 'second call sees no new change');
  });

  it('handles CLAUDE.md being added after snapshot', () => {
    const cwd = tmp('added');
    delta.snapshot(cwd);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'new instructions\n');
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'small_diff');
    assert.ok(r.added.includes('new instructions'));
  });
});
