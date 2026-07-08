'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createRepeatToolDetector,
  formatRepeatWarningNote,
  normalizeReadFileRange,
} = require('../../src/runner/repeat-tool-detector');

describe('repeat tool detector', () => {
  it('normalizes equivalent default read_file ranges', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repeat-normalize-'));
    const ctx = { cwd: tmpDir };

    const shorthand = normalizeReadFileRange({ name: 'read_file', input: { path: './src/app.js' } }, ctx);
    const explicit = normalizeReadFileRange(
      { name: 'read_file', input: { path: 'src/app.js', offset: 1, max_lines: 1000, max_bytes: 50000 } },
      ctx,
    );

    assert.equal(shorthand.key, explicit.key);
    assert.equal(shorthand.path, 'src/app.js');
  });

  it('warns once the same read_file range repeats inside the recent window', () => {
    const detector = createRepeatToolDetector({ threshold: 3, window: 5 });
    const ctx = { cwd: '/tmp/project', compactionGeneration: 2 };

    const first = detector.noteToolResult(
      1,
      { id: 'r1', name: 'read_file', input: { path: 'a.txt', offset: 1, limit: 10 } },
      { ok: true },
      ctx,
    );
    const differentRange = detector.noteToolResult(
      2,
      { id: 'r2', name: 'read_file', input: { path: 'a.txt', offset: 11, limit: 10 } },
      { ok: true },
      ctx,
    );
    const second = detector.noteToolResult(
      3,
      { id: 'r3', name: 'read_file', input: { path: 'a.txt', offset: 1, limit: 10 } },
      { ok: true },
      ctx,
    );
    const third = detector.noteToolResult(
      4,
      { id: 'r4', name: 'read_file', input: { path: 'a.txt', offset: 1, limit: 10 } },
      { ok: true },
      ctx,
    );
    const fourthSameGeneration = detector.noteToolResult(
      5,
      { id: 'r5', name: 'read_file', input: { path: 'a.txt', offset: 1, limit: 10 } },
      { ok: true },
      ctx,
    );

    assert.equal(first, null);
    assert.equal(differentRange, null);
    assert.equal(second, null);
    assert.equal(third.kind, 'repeat_read_file_range');
    assert.equal(third.afterCompaction, true);
    assert.equal(third.count, 3);
    assert.equal(fourthSameGeneration, null);
    assert.match(formatRepeatWarningNote(third), /repeated read_file range/);
  });
});
