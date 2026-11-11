'use strict';

/**
 * false-green-suite-integrity.test.js — FG-G series: guarding the GUARDS.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The other five false-green files (FG-A..F) ask "would we notice if the
 * PRODUCT broke?". This file asks the prior question: "would we notice if the
 * TEST SUITE ITSELF quietly stopped checking?"
 *
 * That failure mode is real and it is invisible by construction, because every
 * symptom of it looks like a pass:
 *
 *   - a test file added in a subdirectory the npm glob does not match never
 *     runs, and the suite still says green;
 *   - `it.only` shrinks a 900-test run to 1 test, and the suite still says green;
 *   - a failing test annotated `{ todo: ... }` reports `not ok` but does NOT
 *     set a non-zero exit code, and the suite still says green;
 *   - a whole test file deleted in a refactor removes its coverage, and the
 *     suite still says green.
 *
 * Each `it` below closes one of those. They are deliberately cheap and static
 * (they read files, they do not spawn the runner) so they can sit in the fast
 * part of the suite.
 *
 * Related: docs/false-green-verification-2026-08-07.html
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(REPO, 'test');

/** Recursively collect every *.test.js file that physically exists. */
function allTestFilesOnDisk(dir = TEST_DIR, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // node_modules should never appear under test/, but be defensive.
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      allTestFilesOnDisk(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      acc.push(path.relative(REPO, path.join(dir, entry.name)));
    }
  }
  return acc;
}

/**
 * Expand the globs in the `npm test` script the same way a shell would, so we
 * compare against what ACTUALLY runs rather than what we assume runs.
 * Only the simple `dir/*.test.js` shape used by this repo is supported; if the
 * script grows a shape we do not understand we fail loudly rather than guess.
 */
function filesMatchedByTestScript() {
  const script = require(path.join(REPO, 'package.json')).scripts.test;
  const globs = script.split(/\s+/).filter((tok) => tok.endsWith('*.test.js'));
  assert.ok(globs.length > 0, 'npm test script no longer contains any *.test.js glob');

  const matched = new Set();
  for (const glob of globs) {
    const dir = path.dirname(glob);
    assert.ok(
      !dir.includes('*'),
      `FG-G1 cannot interpret glob "${glob}" — update this helper if the test script changes shape`,
    );
    const abs = path.join(REPO, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.test.js')) matched.add(path.join(dir, name));
    }
  }
  return matched;
}

const readTestSources = () =>
  allTestFilesOnDisk().map((rel) => ({ rel, src: fs.readFileSync(path.join(REPO, rel), 'utf8') }));

describe('FG-G suite-execution integrity', () => {
  // FG-G1: the orphan detector. A test file living in test/runner/harbor/ (or
  // any other subdirectory) is never executed by `npm test`, because the script
  // globs only test/*.test.js and test/runner/*.test.js. Such a file looks like
  // coverage in code review and contributes nothing at runtime.
  it('FG-G1: every *.test.js on disk is actually executed by the npm test script', () => {
    const onDisk = allTestFilesOnDisk();
    const matched = filesMatchedByTestScript();
    const orphans = onDisk.filter((rel) => !matched.has(rel));
    assert.deepEqual(
      orphans,
      [],
      'These test files exist but are NEVER run by `npm test` — they are decorative coverage:\n  ' +
        orphans.join('\n  ') +
        '\nEither move them into a globbed directory or widen the test script.',
    );
  });

  // FG-G2: `.only` is the single fastest way to turn a 900-test suite into a
  // 1-test suite while every reporter still prints green. Committing one is
  // almost always an accident left over from debugging.
  it('FG-G2: no committed .only() focus anywhere in the suite', () => {
    const offenders = readTestSources()
      .filter(({ src }) => /\b(?:it|test|describe|suite)\.only\s*\(/.test(src))
      .map(({ rel }) => rel);
    assert.deepEqual(
      offenders,
      [],
      `.only() found — it silently disables the rest of the suite: ${offenders.join(', ')}`,
    );
  });

  // FG-G3: `{ todo: ... }` makes a FAILING test report `not ok` without setting
  // a non-zero exit code. That is a legitimate way to record a known gap, but
  // it is also a way to make a real regression permanently invisible. So we pin
  // the register: adding a new todo is allowed, but it must be declared here in
  // the same commit, which forces the decision to be reviewed.
  // HS-01 was the final registered TODO. Keep the explicit empty object so a
  // future masked test still makes this guard fail until a reviewer records it.
  const KNOWN_TODOS = {};

  it('FG-G3: todo-masked tests match the reviewed register exactly', () => {
    const actual = {};
    for (const { rel, src } of readTestSources()) {
      // Count `{ todo:` option objects passed to it()/test() — in CODE only.
      // Comments must be stripped first: this very file's documentation talks
      // about the `{ todo: ... }` pattern, and an unstripped scan counted its
      // own prose as 4 masked tests (this test shipped red on 2026-08-07 for
      // exactly that reason — a self-referential false RED).
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
      const n = (code.match(/\{\s*todo\s*:/g) || []).length;
      if (n > 0) actual[rel] = n;
    }
    assert.deepEqual(
      actual,
      KNOWN_TODOS,
      'The set of todo-masked (known-failing-but-not-red) tests changed.\n' +
        'A todo test reports `not ok` but does NOT fail `npm test`, so this drift is invisible.\n' +
        'If you added a known gap on purpose, add it to KNOWN_TODOS with a comment saying why.',
    );
  });

  // FG-G4: a test file deleted during a refactor removes its coverage silently —
  // the suite goes green *faster*. A floor makes a large accidental deletion
  // fail loudly. It is deliberately a floor, not an equality, so adding tests
  // never requires touching this number.
  it('FG-G4: the suite has not silently shrunk below its known floor', () => {
    const count = allTestFilesOnDisk().length;
    const FLOOR = 118; // measured 123 on 2026-08-07; headroom for intentional consolidation
    assert.ok(
      count >= FLOOR,
      `Only ${count} test files found, floor is ${FLOOR}. Test files were deleted — ` +
        'confirm that was intentional, then lower the floor in the same commit.',
    );
  });

  // FG-G5: a `describe` containing no `it` is a green no-op. This catches the
  // case where assertions get commented out during debugging and the block is
  // committed as an empty shell.
  it('FG-G5: no test file declares suites without any test cases', () => {
    const offenders = readTestSources()
      .filter(({ src }) => /\bdescribe\s*\(/.test(src) && !/\b(?:it|test)\s*\(/.test(src))
      .map(({ rel }) => rel);
    assert.deepEqual(offenders, [], `describe() with zero it() — a green no-op: ${offenders.join(', ')}`);
  });

  // FG-G6: every test file must actually import an assertion library. A file
  // that only calls production code and never asserts is a smoke test wearing a
  // unit test's name; it passes as long as nothing throws.
  it('FG-G6: every test file imports an assertion mechanism', () => {
    const offenders = readTestSources()
      .filter(({ src }) => !/require\(['"]node:assert/.test(src) && !/\bassert\b/.test(src))
      .map(({ rel }) => rel);
    assert.deepEqual(offenders, [], `test files with no assertions at all: ${offenders.join(', ')}`);
  });
});

describe('FG-G harness-configuration integrity', () => {
  // FG-G7: the setup shim installs shared guards. If the `--require` is dropped
  // from the test script the whole suite may still pass — with those guards off.
  it('FG-G7: the npm test script still loads the shared setup shim', () => {
    const script = require(path.join(REPO, 'package.json')).scripts.test;
    assert.match(
      script,
      /--require\s+\.\/test\/setup\.js/,
      'npm test no longer requires test/setup.js — shared test guards would silently stop applying',
    );
  });

  // FG-G8: exit-code masking. `|| true`, `; exit 0`, or a trailing `|| echo` in
  // the test script makes CI green no matter what the runner reports. This is
  // the most direct false green possible and it lives in one line of JSON.
  it('FG-G8: the npm test script does not mask its exit code', () => {
    const script = require(path.join(REPO, 'package.json')).scripts.test;
    for (const bad of ['|| true', '|| :', '; exit 0', '|| exit 0']) {
      assert.ok(!script.includes(bad), `npm test masks failures with "${bad}" — CI can never go red`);
    }
  });

  // FG-G9: keeps the mutation harness honest. Each mutation anchors on an exact
  // source string; when the source drifts the anchor stops matching and the
  // mutation silently tests nothing (reported as STALE). Asserting the anchors
  // still resolve means "our regression-detector detector" cannot rot quietly.
  it('FG-G9: every mutation-check anchor still matches its source exactly once', () => {
    const scriptPath = path.join(REPO, 'scripts', 'mutation-check.js');
    if (!fs.existsSync(scriptPath)) return; // harness is optional tooling
    const src = fs.readFileSync(scriptPath, 'utf8');

    // Pull the literal `file:` / `find:` pairs out of the catalog without
    // executing the harness (executing it would mutate real source files).
    const entries = [...src.matchAll(/file:\s*'([^']+)',\s*\n\s*find:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)];
    assert.ok(entries.length > 0, 'could not parse the mutation catalog — update this test alongside the harness');

    const stale = [];
    for (const m of entries) {
      const rel = m[1];
      // Un-escape the JS string literal so it matches the real file bytes.
      const needle = (m[2] !== undefined ? m[2] : m[3]).replace(/\\(.)/g, '$1');
      const abs = path.join(REPO, rel);
      if (!fs.existsSync(abs)) {
        stale.push(`${rel} (file missing)`);
        continue;
      }
      const hay = fs.readFileSync(abs, 'utf8');
      const hits = hay.split(needle).length - 1;
      if (hits !== 1) stale.push(`${rel} :: ${JSON.stringify(needle)} matched ${hits}x`);
    }
    assert.deepEqual(
      stale,
      [],
      'Mutation anchors no longer match their source. Those mutations now test NOTHING ' +
        '(they report STALE, not FAIL). Re-point them at the current code:\n  ' +
        stale.join('\n  '),
    );
  });

  // FG-G10: bin/ and scripts/ were omitted from `npm run lint` and
  // `npm run format:check`, letting a real duplicate `exposedTools` key land
  // in bin/local-bridge-runner.js undetected. Lock directory coverage on both.
  it('FG-G10: npm run lint and format:check cover bin/, src/, test/, and scripts/', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts || {};
    for (const dir of ['bin/', 'src/', 'test/', 'scripts/']) {
      assert.ok(
        typeof scripts.lint === 'string' && new RegExp('(^|\\s)' + dir + '(\\s|$)').test(scripts.lint),
        `package.json scripts.lint does not cover whole directory "${dir}" (got: ${scripts.lint})`,
      );
    }
    for (const glob of ['bin/**/*.js', 'src/**/*.js', 'test/**/*.js', 'scripts/**/*.js']) {
      assert.ok(
        typeof scripts['format:check'] === 'string' && scripts['format:check'].includes(glob),
        `package.json scripts["format:check"] does not cover "${glob}"`,
      );
    }
  });

  // FG-G11: .cursor/hooks/state/continual-learning.json was appended to
  // .gitignore THREE separate times (commits 8bfe4b6, f05f69e, f85ad5f) while
  // remaining tracked in Git's index, so .gitignore had zero effect and every
  // Cursor turn kept dirtying the working tree.
  it('FG-G11: .gitignore has no duplicate entries and .cursor/hooks/state/* is not tracked in Git', () => {
    const rawLines = fs
      .readFileSync(path.join(REPO, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    const seen = new Set();
    const dupes = [];
    for (const line of rawLines) {
      if (seen.has(line)) dupes.push(line);
      seen.add(line);
    }
    assert.deepEqual(dupes, [], 'Duplicate pattern(s) in .gitignore: ' + dupes.join(', '));

    if (fs.existsSync(path.join(REPO, '.git'))) {
      const tracked = execFileSync('git', ['ls-files', '.cursor/hooks/state'], {
        cwd: REPO,
        encoding: 'utf8',
      })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      assert.deepEqual(
        tracked,
        [],
        '.cursor/hooks/state/* is tracked in Git despite .gitignore — run `git rm --cached ' +
          tracked.join(' ') +
          '` so local hook state stops dirtying the working tree.',
      );
    }
  });

  // FG-G12: three thermo-nuclear reviews flagged monolith creep past 1,000
  // lines (`acp/agent.js`, `acp-agent.test.js`, `starlark-host/src/coordinator.js`,
  // and `src/runner/run.js`). Enforce <= 1,000 lines on every JS file, with one
  // explicit non-increasing ratchet on `src/runner/run.js` so no slice can feed
  // it more lines without extracting a focused module first.
  it('FG-G12: JS files stay within the 1,000-line ceiling (and run.js never exceeds its ratchet)', () => {
    const DEFAULT_MAX_LINES = 1000;
    const LINE_CEILING_EXCEPTIONS = {
      // EXCEPTION: legacy main runner loop predates the 1k-line rule; owner-approved review directive
      // (`HANDOFF-acp-hosts-images-thermo-nuclear-2026-10-17.md:30` "Do not split run.js" unbidden);
      // expiry: 2027-02-10 — ratchet may move DOWN when extracted, never UP.
      'src/runner/run.js': 1992,
    };

    const ROOTS = ['bin', 'src', 'test', 'starlark-host/src', 'starlark-host/test'];
    const offenders = [];

    function walkJs(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walkJs(abs);
        else if (entry.isFile() && entry.name.endsWith('.js')) {
          const rel = path.relative(REPO, abs).split(path.sep).join('/');
          const lines = fs.readFileSync(abs, 'utf8').split('\n').length;
          const cap = LINE_CEILING_EXCEPTIONS[rel] ?? DEFAULT_MAX_LINES;
          if (lines > cap) {
            offenders.push(`${rel}: ${lines} lines > ceiling ${cap} — extract a sibling module instead of growing it`);
          }
        }
      }
    }

    for (const r of ROOTS) walkJs(path.join(REPO, r));
    assert.deepEqual(offenders, [], 'Monolith line-ceiling violation(s):\n  ' + offenders.join('\n  '));
  });

  // FG-G13: commits 24d0df8, 1d1fb0f, 0a26f14, and f85ad5f landed with failing
  // tests, formatting, or doc checks because .github/workflows/ only deployed
  // Pages and ran CodeQL. Pin a real CI workflow running the same local gates.
  it('FG-G13: .github/workflows/ci.yml runs lint, check:docs, format:check, test, and test:starlark on push/PR', () => {
    const ciPath = path.join(REPO, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), 'Missing .github/workflows/ci.yml — local checks are not enforced in CI');
    const ci = fs.readFileSync(ciPath, 'utf8');
    assert.match(ci, /\bpush\s*:/, 'ci.yml must run on push');
    assert.match(ci, /\bpull_request\s*:/, 'ci.yml must run on pull_request');
    for (const cmd of [
      'npm run lint',
      'npm run check:docs',
      'npm run format:check',
      'npm test',
      'npm run test:starlark',
    ]) {
      assert.ok(ci.includes(cmd), `ci.yml is missing "${cmd}" — CI and local checks must run the same commands`);
    }
  });
});
