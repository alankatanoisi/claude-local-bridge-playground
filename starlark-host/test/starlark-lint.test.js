'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CostBudget } = require('../src/bridge');
const { PhasedCoordinator } = require('../src/coordinator');
const { lintStarlark } = require('../src/starlark-lint');

function lintFixtureConfig(root) {
  return {
    targetRoot: root,
    objective: 'Analyze the supplied fixture.',
    documents: [{ id: 'one', path: 'one.txt' }],
    maxDocumentBytes: 1000,
    maxJobsPerPhase: 1,
    maxConcurrency: 1,
    maxTaskCharacters: 1200,
    maxStarlarkSteps: 100000,
    starlarkTimeoutMs: 1000,
    workerProfiles: { code_analyst: { maxOutputTokens: 1200, system: 'Return strict JSON.' } },
  };
}

const WORKER_JSON = JSON.stringify({ summary: 'ok', claims: [], evidence: [], confidence: 0.5 });

// A plan whose task string is split across adjacent literals — the exact
// Python-ism seen live. Valid ONLY after the linter inserts the '+'.
const ADJACENT_PLAN = [
  'def plan(ctx):',
  '    jobs = []',
  '    for doc in ctx["documents"]:',
  '        jobs.append({',
  '            "id": "analyze_" + doc["id"],',
  '            "worker": "code_analyst",',
  '            "task": "Analyze the supplied file for the objective"',
  '                " and report one failure mode.",',
  '            "input_ids": [doc["id"]],',
  '            "depends_on": [],',
  '            "timeout_ms": 30000,',
  '            "max_output_tokens": 900,',
  '        })',
  '    return jobs',
].join('\n');

test('auto-repairs adjacent string literals on one line', () => {
  const result = lintStarlark('x = "analyze " "the file"');
  assert.equal(result.source, 'x = "analyze " + "the file"');
  assert.deepEqual(result.applied.map((fix) => fix.rule), ['adjacent-strings']);
  assert.equal(result.diagnostics.length, 0);
});

test('auto-repairs adjacent string literals across lines inside brackets', () => {
  const source = ['jobs.append({', '    "task": "analyze the file"', '        " for risks",', '})'].join('\n');
  const result = lintStarlark(source);
  assert.match(result.source, /"analyze the file" \+\n\s+" for risks"/);
  assert.equal(result.applied.length, 1);
});

test('auto-repairs zero-gap adjacency', () => {
  const result = lintStarlark('x = "a""b"');
  assert.equal(result.source, 'x = "a" +"b"');
  assert.equal(result.applied.length, 1);
});

test('does NOT join comma-separated or statement-separated strings', () => {
  const clean = lintStarlark('x = ["a", "b"]\ny = "c"\nz = "d"');
  assert.equal(clean.applied.length, 0);
  assert.equal(clean.source, 'x = ["a", "b"]\ny = "c"\nz = "d"');
});

test('keywords inside strings and comments never trigger rules', () => {
  const source = 'x = "while import class try: f-string"  # while class import\ny = 1';
  const result = lintStarlark(source);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.applied.length, 0);
});

test('f-strings are diagnosed with a line number, not auto-repaired', () => {
  const result = lintStarlark('def plan(ctx):\n    x = f"job {1}"\n    return []');
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].rule, 'f-string');
  assert.match(result.diagnostics[0].message, /line 2/);
  assert.equal(result.source, 'def plan(ctx):\n    x = f"job {1}"\n    return []');
});

test('while, import, try/except, class, load, and yield-family are diagnosed', () => {
  const source = [
    'import os',
    'load("x.star", "y")',
    'class Foo:',
    'def plan(ctx):',
    '    while True:',
    '        pass',
    '    try:',
    '        yield 1',
    '    except:',
    '        raise',
  ].join('\n');
  const result = lintStarlark(source);
  const rules = new Set(result.diagnostics.map((diagnostic) => diagnostic.rule));
  for (const expected of ['import', 'load-disabled', 'class', 'while-loop', 'exceptions', 'unsupported-keyword']) {
    assert.ok(rules.has(expected), `expected rule '${expected}' in ${[...rules].join(', ')}`);
  }
  // Diagnostics carry ascending line numbers for precise repair guidance.
  const lines = result.diagnostics.map((diagnostic) => diagnostic.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
});

test('triple-quoted strings are handled as single literals', () => {
  const source = 'x = """line one\nwhile True\n"""\ny = "b"';
  const result = lintStarlark(source);
  assert.equal(result.diagnostics.length, 0, 'keyword inside triple-quoted string must not fire');
  assert.equal(result.applied.length, 0, 'triple string then separate statement is not adjacency');
});

test('coordinator: adjacent-string plan is auto-repaired and accepted first-pass', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-repair-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const budget = new CostBudget(0);
  const bridge = {
    budget,
    async call(request) {
      const text = request.label.startsWith('plan:')
        ? ADJACENT_PLAN
        : request.label.startsWith('worker:')
          ? WORKER_JSON
          : 'Mock synthesis complete.';
      await budget.record({ label: request.label, costUsd: 0 });
      return { text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-repair-run-'));
  const coordinator = new PhasedCoordinator({
    config: lintFixtureConfig(root),
    bridge,
    plannerModel: 'mock-planner',
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
  });
  const result = await coordinator.run();
  assert.equal(result.phase, 'completed');
  assert.deepEqual(result.planMetrics, {
    attempts: 1,
    repairs: 0,
    firstPassValid: true,
    lintFixes: 1,
    model: 'mock-planner',
    escalations: 0,
  });
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /plan_lint_repaired/);
  assert.match(events, /adjacent-strings/);
});

test('coordinator: f-string plan is rejected with lint guidance in the repair prompt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-reject-'));
  fs.writeFileSync(path.join(root, 'one.txt'), 'fixture one\n');
  const budget = new CostBudget(0);
  const prompts = [];
  let attempts = 0;
  const bridge = {
    budget,
    async call(request) {
      let text;
      if (request.label.startsWith('plan:')) {
        prompts.push(request.prompt);
        attempts += 1;
        text =
          attempts === 1
            ? 'def plan(ctx):\n    x = f"bad {1}"\n    return []'
            : ADJACENT_PLAN;
      } else if (request.label.startsWith('worker:')) {
        text = WORKER_JSON;
      } else {
        text = 'Mock synthesis complete.';
      }
      await budget.record({ label: request.label, costUsd: 0 });
      return { text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
    },
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-reject-run-'));
  const coordinator = new PhasedCoordinator({
    config: lintFixtureConfig(root),
    bridge,
    plannerModel: 'mock-planner',
    workerModel: 'mock-worker',
    faultProfile: 'none',
    runDir,
  });
  const result = await coordinator.run();
  assert.equal(result.phase, 'completed');
  assert.equal(result.planMetrics.attempts, 2);
  // The second prompt must carry the linter's precise guidance.
  assert.match(prompts[1], /pre-lint rejected/);
  assert.match(prompts[1], /no f-strings/);
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(events, /"lintRules":\["f-string"\]/);
});

test('a realistic broken plan is repaired into evaluable form', () => {
  // The exact failure shape seen live on 2026-08-06: a task string split
  // across lines inside a dict literal.
  const source = [
    'def plan(ctx):',
    '    jobs = []',
    '    for doc in ctx["documents"]:',
    '        jobs.append({',
    '            "id": "analyze_" + doc["id"],',
    '            "task": "Analyze the supplied file"',
    '                " and report one failure mode.",',
    '        })',
    '    return jobs',
  ].join('\n');
  const result = lintStarlark(source);
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.applied.length, 1);
  assert.match(result.source, /"Analyze the supplied file" \+/);
});
