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

describe('P1-13 policy-derived instruction sources', () => {
  beforeEach(() => {
    delta.reset();
  });

  it('watchedSourcesForPolicy maps context policy to watched files', () => {
    // Full instruction docs → all project instruction files are watched.
    assert.deepEqual(delta.watchedSourcesForPolicy({ includeInstructionDocs: true }), [
      'AGENTS.md',
      'CLAUDE.md',
      'RUNNER.md',
    ]);
    // Repo-context CLAUDE.md only → only CLAUDE.md is watched.
    assert.deepEqual(delta.watchedSourcesForPolicy({ includeClaudeMdInRepoContext: true }), ['CLAUDE.md']);
    // Bare/minimal → nothing is watched.
    assert.deepEqual(delta.watchedSourcesForPolicy({}), []);
    assert.deepEqual(delta.watchedSourcesForPolicy(), []);
  });

  it('ignores CLAUDE.md edits when nothing is watched (bare/minimal context)', () => {
    const cwd = tmp('bare');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'v1\n');
    delta.snapshot(cwd, []); // operator excluded instruction docs from context
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'injected mid-session\n');
    assert.equal(delta.detectChange(cwd), null, 'excluded file must not alter the session');
  });

  it('watches AGENTS.md when instruction docs are part of context', () => {
    const cwd = tmp('agents');
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'rule one\n');
    const sources = delta.watchedSourcesForPolicy({ includeInstructionDocs: true });
    delta.snapshot(cwd, sources);
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'rule one\nrule two\n');
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'small_diff');
    assert.ok(r.added.includes('rule two'));
    assert.equal(r.sources.length, 1);
    assert.equal(r.sources[0].source, 'AGENTS.md');
    assert.match(r.sources[0].hash, /^[0-9a-f]{16}$/, 'delta carries the new content hash');
    assert.match(r.deltaBlock, /AGENTS\.md/, 'delta block names its source file');
  });

  it('reports each changed source separately when multiple docs change', () => {
    const cwd = tmp('multi');
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'a1\n');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'c1\n');
    delta.snapshot(cwd, delta.watchedSourcesForPolicy({ includeInstructionDocs: true }));
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'a1\na2\n');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'c1\nc2\n');
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'small_diff');
    assert.deepEqual(
      r.sources.map((s) => s.source).sort(),
      ['AGENTS.md', 'CLAUDE.md'],
    );
    assert.match(r.deltaBlock, /AGENTS\.md/);
    assert.match(r.deltaBlock, /CLAUDE\.md/);
  });

  it('large_rewrite result still identifies its sources', () => {
    const cwd = tmp('largesrc');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'short\n');
    delta.snapshot(cwd, ['CLAUDE.md']);
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'huge content\n'.repeat(1000));
    const r = delta.detectChange(cwd);
    assert.equal(r.kind, 'large_rewrite');
    assert.equal(r.sources[0].source, 'CLAUDE.md');
    assert.match(r.sources[0].hash, /^[0-9a-f]{16}$/);
  });
});
