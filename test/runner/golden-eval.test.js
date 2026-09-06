'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  DEFAULT_GOLDEN_DIR,
  executeGoldenCase,
  evaluateChecklist,
  loadGoldenCase,
  normalizeSnapshot,
  runGoldenEval,
  diffObjects,
} = require('../../src/runner/golden-eval');

describe('golden-eval harness', () => {
  it('loads canned cases from test/runner/golden', () => {
    const cases = fs.readdirSync(DEFAULT_GOLDEN_DIR).filter((name) => name.endsWith('.json'));
    // 2 legacy snapshot cases + 7 HE-06 checklist cases.
    assert.ok(cases.length >= 9);
    for (const name of cases) {
      const data = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, name));
      assert.ok(data.id);
      // Single-phase cases carry a top-level script; multi-phase cases carry
      // one per phase. Every case must be scoreable by at least one mode.
      if (Array.isArray(data.phases)) {
        assert.ok(data.phases.every((phase) => Array.isArray(phase.model_script)));
      } else {
        assert.ok(Array.isArray(data.model_script));
      }
      assert.ok(data.expect || (Array.isArray(data.checklist) && data.checklist.length > 0));
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

  it('runGoldenEval reports an aggregate checklist score', async () => {
    const summary = await runGoldenEval({ filter: 'he06', verbose: false });
    assert.equal(summary.ok, true, JSON.stringify(summary.results, null, 2));
    assert.ok(summary.checklistTotals.total > 0);
    assert.equal(summary.checklistTotals.passed, summary.checklistTotals.total);
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

describe('golden-eval terminal-state checklists (HE-06 / research review idea 2)', () => {
  // Synthetic terminal state used by the pure predicate tests below — no run()
  // involved, so these stay fast and pinpoint predicate semantics.
  function fakeTerminal(cwd) {
    return {
      cwd,
      phases: [
        {
          phase: 1,
          stopReason: 'max_steps',
          steps: 1,
          finalText: '',
          toolResults: [{ name: 'list_files', ok: true, permission: null, content: 'listing' }],
          traceEventTypes: ['run_started'],
        },
        {
          phase: 2,
          stopReason: 'success',
          steps: 2,
          finalText: 'all done',
          toolResults: [
            {
              name: 'read_file',
              ok: false,
              permission: { decision: 'deny' },
              content: 'denied: blocked path',
            },
          ],
          traceEventTypes: ['run_started', 'run_completed'],
        },
      ],
    };
  }

  it('scores each predicate independently and reports a pass fraction', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-checklist-'));
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello\n');
    const result = evaluateChecklist(
      [
        { name: 'last phase succeeded', check: 'stop_reason', equals: 'success' },
        { name: 'phase 1 hit max steps', check: 'stop_reason', phase: 1, equals: 'max_steps' },
        { name: 'a.txt kept', check: 'file_content', path: 'a.txt', equals: 'hello\n' },
        { name: 'no stray file', check: 'file_absent', path: 'stray.txt' },
        { name: 'read was denied', check: 'tool_denied', tool: 'read_file' },
        { name: 'this one fails', check: 'file_exists', path: 'missing.txt' },
      ],
      fakeTerminal(tmp),
    );
    assert.equal(result.total, 6);
    assert.equal(result.passed, 5);
    assert.ok(Math.abs(result.fraction - 5 / 6) < 1e-9);
    const failed = result.items.filter((item) => !item.ok);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].name, 'this one fails');
    assert.ok(failed[0].detail);
  });

  it('tool predicates default to all phases; phase pins them down', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-checklist-'));
    const terminal = fakeTerminal(tmp);
    const allPhases = evaluateChecklist([{ check: 'tool_called', tool: 'list_files' }], terminal);
    assert.equal(allPhases.passed, 1);
    const pinned = evaluateChecklist([{ check: 'tool_called', tool: 'list_files', phase: 2 }], terminal);
    assert.equal(pinned.passed, 0);
  });

  it('an unknown check type fails instead of silently passing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-checklist-'));
    const result = evaluateChecklist([{ name: 'typo', check: 'file_exits', path: 'a.txt' }], fakeTerminal(tmp));
    assert.equal(result.passed, 0);
    assert.match(result.items[0].detail, /unknown check type/);
  });

  it('file predicates cannot escape the case cwd', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-checklist-'));
    const result = evaluateChecklist(
      [{ name: 'escape attempt', check: 'file_exists', path: '../../etc/hosts' }],
      fakeTerminal(tmp),
    );
    assert.equal(result.passed, 0);
    assert.match(result.items[0].detail, /escapes case cwd/);
  });

  it('tool_result_lacks passes on absence and fails on a leak', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-checklist-'));
    const terminal = fakeTerminal(tmp);
    const clean = evaluateChecklist([{ check: 'tool_result_lacks', tool: 'read_file', lacks: 'SECRET' }], terminal);
    assert.equal(clean.passed, 1);
    const leaked = evaluateChecklist([{ check: 'tool_result_lacks', tool: 'read_file', lacks: 'blocked' }], terminal);
    assert.equal(leaked.passed, 0);
  });

  it('replays the symlink-deny case: gate blocks the aliased read, nothing leaks', async () => {
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'he06-symlink-deny.json'));
    const { phases, cwd } = await executeGoldenCase(caseData);
    const score = evaluateChecklist(caseData.checklist, { cwd, phases });
    assert.equal(score.fraction, 1, JSON.stringify(score.items, null, 2));
    // Belt and braces beyond the checklist: the deny-listed target is intact.
    assert.equal(fs.readFileSync(path.join(cwd, '.env'), 'utf8'), 'FAKE_GOLDEN_TOKEN=deny-me\n');
  });

  it('replays the two-phase resume-degraded case end to end', async () => {
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'he06-resume-degraded.json'));
    const { phases, cwd } = await executeGoldenCase(caseData);
    assert.equal(phases.length, 2);
    assert.equal(phases[0].stopReason, 'max_steps');
    assert.equal(phases[1].stopReason, 'resume_failed');
    const score = evaluateChecklist(caseData.checklist, { cwd, phases });
    assert.equal(score.fraction, 1, JSON.stringify(score.items, null, 2));
  });

  it('replays the shell-hidden-dont-ask case: dont-ask alone never enables shell', async () => {
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'he06-shell-hidden-dont-ask.json'));
    const { phases, cwd } = await executeGoldenCase(caseData);
    const score = evaluateChecklist(caseData.checklist, { cwd, phases });
    assert.equal(score.fraction, 1, JSON.stringify(score.items, null, 2));
    assert.equal(fs.existsSync(path.join(cwd, 'pwned.txt')), false);
  });

  it('a checklist regression fails the case with a named predicate', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-checklist-case-'));
    const caseData = loadGoldenCase(path.join(DEFAULT_GOLDEN_DIR, 'he06-authority-ceiling.json'));
    // Sabotage one predicate: claim the refused write SHOULD have landed.
    caseData.checklist = [{ name: 'wrong claim', check: 'file_exists', path: 'evil.txt' }];
    fs.writeFileSync(path.join(tmp, 'sabotaged.json'), JSON.stringify(caseData), 'utf8');
    const summary = await runGoldenEval({ dir: tmp });
    assert.equal(summary.ok, false);
    assert.equal(summary.failed, 1);
    assert.match(summary.results[0].message, /wrong claim/);
  });
});
