'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  DEFAULT_GOLDEN_DIR,
  executeGoldenCase,
  loadGoldenCase,
  normalizeSnapshot,
  runGoldenEval,
  diffObjects,
} = require('../../src/runner/golden-eval');

describe('golden-eval harness', () => {
  it('loads canned cases from test/runner/golden', () => {
    const cases = fs.readdirSync(DEFAULT_GOLDEN_DIR).filter((name) => name.endsWith('.json'));
    assert.ok(cases.length >= 2);
    for (const name of cases) {
      const data = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, name));
      assert.ok(data.id);
      assert.ok(Array.isArray(data.model_script));
      assert.ok(data.expect);
    }
  });

  it('normalizes cwd and timestamp fields for portable diffs', () => {
    const cwd = '/tmp/golden-case';
    const normalized = normalizeSnapshot(
      {
        stopReason: 'success',
        trace_event_types: ['run_started'],
        tool_sequence: [{ name: 'list_files', path: cwd + '/hello.js' }],
      },
      { cwd, home: '/home/tester' },
    );
    assert.equal(normalized.tool_sequence[0].path, '<CWD>/hello.js');
  });

  it('replays read-list-then-answer without regression', async () => {
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'read-list-then-answer.json'));
    const { actual } = await executeGoldenCase(caseData);
    const diffs = diffObjects(caseData.expect, actual);
    assert.deepEqual(diffs, [], diffs.map((d) => d.path + ': ' + JSON.stringify(d)).join('\n'));
  });

  it('replays plan-mode-write-blocked without touching disk', async () => {
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'plan-mode-write-blocked.json'));
    const { actual, cwd } = await executeGoldenCase(caseData);
    const diffs = diffObjects(caseData.expect, actual);
    assert.deepEqual(diffs, []);
    assert.equal(fs.readFileSync(path.join(cwd, 'notes.txt'), 'utf8'), 'original\n');
  });

  it('runGoldenEval passes all shipped goldens', async () => {
    const summary = await runGoldenEval({ verbose: false });
    assert.equal(summary.ok, true, JSON.stringify(summary.results, null, 2));
    assert.equal(summary.failed, 0);
  });

  it('detects diffs when expectation is wrong', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-diff-'));
    const casePath = path.join(tmp, 'broken.json');
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'read-list-then-answer.json'));
    caseData.expect = { ...caseData.expect, stopReason: 'max_steps' };
    fs.writeFileSync(casePath, JSON.stringify(caseData), 'utf8');

    const summary = await runGoldenEval({ dir: tmp });
    assert.equal(summary.ok, false);
    assert.equal(summary.failed, 1);
  });
});
