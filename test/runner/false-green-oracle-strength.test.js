'use strict';

/**
 * false-green-oracle-strength.test.js — FG-M series.
 *
 * The FG-A..L files ask "would we notice if the PRODUCT broke?". FG-G asks
 * "would we notice if the suite stopped RUNNING?". This file asks the third
 * question, the one in between:
 *
 *     Would we notice if the suite still ran, still reported green, and its
 *     assertions had quietly stopped being able to fail?
 *
 * A test can execute, report `ok`, and check nothing:
 *
 *   - `assert.throws(fn)` with no matcher passes when fn throws ANYTHING —
 *     including the `TypeError: x is not a function` a broken refactor
 *     produces. The test that was supposed to prove "we reject bad input"
 *     starts proving "we crash", and stays green.
 *   - `assert.rejects(...)` without `await` returns a promise nobody inspects.
 *     The assertion runs after the test has already passed.
 *   - `{ skip: cond }` removes a test on some machines only. Unlike `{ todo }`
 *     (pinned by FG-G3), nothing recorded which tests can vanish.
 *   - A test whose outcome depends on the process it runs in tests the harness,
 *     not the product.
 *
 * The first three are zero-tolerance guards: the suite has NO violations today
 * (verified 2026-08-08), so these lock in a good state rather than grandfather
 * a bad one.
 *
 * FG-M6/HS-03 record two concrete instances found while writing this file.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(REPO, 'test');

function allTestFiles(dir = TEST_DIR, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') allTestFiles(p, acc);
    else if (entry.name.endsWith('.test.js')) acc.push(p);
  }
  return acc;
}

/**
 * Blank out comments while respecting string, template and regex literals.
 *
 * Both naive approaches fail on this repo, and both failures were observed
 * while writing this file:
 *
 *   - Scanning RAW source makes every detector match its own documentation.
 *     FG-G3 shipped red in exactly this way on 2026-08-07.
 *   - Stripping with `src.replace(/\/\*[\s\S]*?\*\//g, '')` eats from a `/*`
 *     that lives inside a STRING — the `'**' + '/*.js'` glob patterns in
 *     glob.test.js are that shape — which invented two phantom offenders.
 *
 * So this walks the source once, tracking which literal context it is in, and
 * replaces comment bytes with spaces (preserving length, so reported line
 * numbers stay accurate).
 */
function stripComments(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let prev = '';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && n === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? src.length : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j++;
      }
      i = j + 1;
      prev = c;
      continue;
    }
    // A `/` in operand position starts a regex literal, not a comment.
    if (c === '/' && /[(=,:[!&|?{};+\-*%]|^$/.test(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        else if (src[j] === '\n') {
          j = -1;
          break;
        }
        j++;
      }
      if (j > 0) {
        i = j + 1;
        prev = '/';
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/**
 * This file is excluded from its own scans. Its detectors search for the
 * literal strings `it(`, `assert.throws(` and `assert.rejects(`, which appear
 * here as STRING LITERALS in the scanning code itself — real code, not
 * comments, so no stripper can remove them. A scanner cannot scan itself
 * without matching its own search terms. FG-M8 keeps this file honest instead.
 */
const SELF = path.relative(REPO, __filename);

const sources = () =>
  allTestFiles()
    .map((f) => ({ rel: path.relative(REPO, f), src: stripComments(fs.readFileSync(f, 'utf8')) }))
    .filter(({ rel }) => rel !== SELF);

/** Extract each `it(...)` call expression with balanced parentheses. */
function itCallExpressions(src) {
  const calls = [];
  let idx = 0;
  while ((idx = src.indexOf('it(', idx)) !== -1) {
    // Skip `wait(`, `submit(`, `.it(` etc.
    if (idx > 0 && /[\w.$]/.test(src[idx - 1])) {
      idx += 3;
      continue;
    }
    let depth = 1;
    let j = idx + 3;
    while (j < src.length && depth > 0) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') depth--;
      j++;
    }
    calls.push(src.slice(idx, j));
    idx = j;
  }
  return calls;
}

/** Count top-level (unnested) commas in an argument list. */
function topLevelCommas(args) {
  let depth = 0;
  let commas = 0;
  for (const ch of args) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) commas++;
  }
  return commas;
}

describe('FG-M assertion oracles can still fail', () => {
  // FG-M1: a test that calls production code and asserts nothing passes as long
  // as nothing throws. It looks like coverage in review and is a smoke test.
  // FG-G6 catches a FILE with no assertions; this catches a single test.
  it('FG-M1: every it() case contains at least one assertion', () => {
    const offenders = [];
    for (const { rel, src } of sources()) {
      for (const call of itCallExpressions(src)) {
        if (!/assert[.(]/.test(call)) {
          const titleMatch = call.match(/^it\(\s*['"`]([^'"`]*)/);
          offenders.push(`${rel} :: "${titleMatch ? titleMatch[1] : '(untitled)'}"`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'Test case(s) with no assertion — they pass whenever the code does not throw:\n  ' + offenders.join('\n  '),
    );
  });

  // FG-M2: the weakest common oracle. `assert.throws(fn)` accepts any error at
  // all, so a refactor that replaces a validation error with a crash keeps the
  // test green while inverting its meaning.
  it('FG-M2: every assert.throws / assert.rejects pins WHICH error it expects', () => {
    const offenders = [];
    for (const { rel, src } of sources()) {
      for (const m of src.matchAll(/assert\.(throws|rejects)\(/g)) {
        let i = m.index + m[0].length;
        let depth = 1;
        let args = '';
        while (i < src.length && depth > 0) {
          const ch = src[i];
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          if (depth > 0) args += ch;
          i++;
        }
        if (topLevelCommas(args) === 0) {
          offenders.push(`${rel} :: assert.${m[1]} at line ${src.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'assert.throws/rejects with no expected-error argument:\n  ' +
        offenders.join('\n  ') +
        '\nThese pass on ANY throw, including a TypeError from a broken import. ' +
        'Add a regex or error class as the second argument.',
    );
  });

  // FG-M3: an unawaited async assertion is evaluated after the test has already
  // reported success. Node may surface an unhandled rejection, but the test
  // result is already `ok`.
  it('FG-M3: every assert.rejects is awaited or returned', () => {
    const offenders = [];
    for (const { rel, src } of sources()) {
      let k = 0;
      while ((k = src.indexOf('assert.rejects(', k)) !== -1) {
        if (!/(await|return)\s+$/.test(src.slice(Math.max(0, k - 40), k))) {
          offenders.push(`${rel} line ${src.slice(0, k).split('\n').length}`);
        }
        k += 'assert.rejects('.length;
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'Unawaited assert.rejects — the assertion resolves after the test already passed:\n  ' + offenders.join('\n  '),
    );
  });

  // FG-M4: the skip register. FG-G3 pins `{ todo: }`; nothing pinned
  // `{ skip: }`. A conditional skip is strictly more dangerous than a todo,
  // because it reports `ok` (not `not ok`) on the machines where it does not
  // run — coverage silently varies by platform and by environment.
  it('FG-M4: conditionally-skipped tests match the reviewed register', () => {
    const KNOWN_SKIPS = {
      // POSIX mode-bit assertions; skipped on Windows and on filesystems
      // that do not preserve permissions.
      'test/runner/fd-10-artifact-modes.test.js': 5,
      'test/runner/private-fs.test.js': 4,
      // Persistent-shell fast path is opt-in and not exercised by default.
      'test/runner/persistent-shell.test.js': 1,
    };

    const actual = {};
    for (const { rel, src } of sources()) {
      const n = (src.match(/\{\s*skip\s*:/g) || []).length;
      if (n > 0) actual[rel] = n;
    }
    assert.deepEqual(
      actual,
      KNOWN_SKIPS,
      'The set of skippable tests changed.\n' +
        'A skipped test reports `ok`, so this drift is invisible in a green run — coverage ' +
        'can differ between your machine and CI. If the change is intentional, update ' +
        'KNOWN_SKIPS with a comment saying which environments lose the check.',
    );
  });

  // FG-M8: guard the guards. FG-M1..M3 are zero-tolerance sweeps that currently
  // report an empty list — and an empty list is what a BROKEN detector also
  // reports. Because this file is excluded from its own scans (see SELF), that
  // risk is concentrated here. So: prove the stripper preserves the code it must
  // preserve, and prove each detector fires on a synthetic violation.
  it('FG-M8: the comment stripper and every detector still fire on known-bad input', () => {
    // --- stripper correctness -------------------------------------------------
    const withComment = 'const a = 1; // assert.throws(fn)\nconst b = 2;';
    assert.ok(!/assert\.throws/.test(stripComments(withComment)), 'line comments must be blanked');

    const globInString = "const g = '**' + '/*.js'; const real = 1;";
    assert.match(stripComments(globInString), /const real = 1;/, 'a `/*` inside a string must not start a comment');

    const regexLiteral = 'const re = /\\/\\*[a-z]*\\*\\//g; const after = 3;';
    assert.match(
      stripComments(regexLiteral),
      /const after = 3;/,
      'a regex literal must not swallow the rest of the file',
    );

    assert.equal(
      stripComments(withComment).length,
      withComment.length,
      'stripping must preserve length (line numbers)',
    );

    // --- detector liveness ----------------------------------------------------
    // A synthetic file containing exactly one of each violation.
    const bad = [
      "it('no assertion here', () => { doSomething(); });",
      "it('weak throw', () => { assert.throws(() => boom()); });",
      "it('unawaited', async () => { assert.rejects(() => boom(), /x/); });",
    ].join('\n');

    const calls = itCallExpressions(bad);
    assert.equal(calls.length, 3, 'the it() extractor must find all three cases');
    assert.equal(
      calls.filter((c) => !/assert[.(]/.test(c)).length,
      1,
      'FG-M1’s rule must flag the assertion-free case',
    );

    const throwsArgs = bad.slice(bad.indexOf('assert.throws(') + 'assert.throws('.length);
    assert.equal(
      topLevelCommas(throwsArgs.slice(0, throwsArgs.indexOf(');'))),
      0,
      'FG-M2’s rule must flag a bare throws',
    );
    assert.equal(topLevelCommas('() => boom(), /x/'), 1, 'FG-M2 must accept a matcher argument');

    const rejectIdx = bad.indexOf('assert.rejects(');
    assert.ok(
      !/(await|return)\s+$/.test(bad.slice(Math.max(0, rejectIdx - 40), rejectIdx)),
      'FG-M3’s rule must flag an unawaited rejects',
    );
    assert.ok(/(await|return)\s+$/.test('const x = await '), 'FG-M3 must accept an awaited rejects');
  });
});

describe('FG-M environment-coupled outcomes', () => {
  // FG-M5: HS-03 — a REAL nondeterminism bug found while auditing.
  //
  // `undo` picks the newest backup by sorting on mtimeMs. saveBackup() writes
  // two backups fast enough that the filesystem stamps them with an IDENTICAL
  // mtime, so the comparator returns 0 and the surviving order is whatever
  // readdir() happened to return — which puts the OLDER backup first. `undo`
  // then restores stale content, silently discarding the newer backup.
  //
  // This is why the existing `undo.test.js` "restores from the newest matching
  // timestamped backup" case fails on this machine: nothing to do with the
  // test, everything to do with a missing tie-break.
  //
  // It is recorded as a todo rather than fixed because the tempting "fix" is to
  // sleep between the two saveBackup() calls in the test — which makes the test
  // green and leaves the data-loss bug in place. The real fix is a deterministic
  // tie-break: saveBackup() already embeds a monotonic sequence number in the
  // filename, so sort on (mtimeMs, seq) instead of mtimeMs alone.
  it(
    'HS-03: undo resolves the newest backup deterministically when mtimes collide',
    { todo: 'known bug — mtime-only sort is nondeterministic on same-millisecond backups; needs a seq tie-break' },
    () => {
      const { saveBackup } = require('../../src/runner/tools/file-write-utils');
      const undo = require('../../src/runner/tools/undo');

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-undo-tie-'));
      const target = path.join(tmp, 'target.js');
      fs.writeFileSync(target, 'current');

      saveBackup(target, Buffer.from('older'), tmp);
      const newer = saveBackup(target, Buffer.from('newer'), tmp);

      // Force the collision the fast path produces naturally, so this test is
      // deterministic on every filesystem rather than only on coarse ones.
      const backupsDir = path.join(tmp, '.bridge-runner', 'backups');
      const stamp = new Date(1_700_000_000_000);
      for (const name of fs.readdirSync(backupsDir)) fs.utimesSync(path.join(backupsDir, name), stamp, stamp);

      undo.execute({ path: 'target.js' }, { cwd: tmp });
      assert.equal(
        fs.readFileSync(target, 'utf8'),
        'newer',
        'undo restored a stale backup — the newest write (' + path.basename(newer) + ') was discarded',
      );
    },
  );

  // FG-M6: structural guard for the bash signal branch.
  //
  // bash.test.js asserts that killing a process reports "killed by signal". That
  // assertion's outcome depends on whether /bin/sh EXECs the command or forks
  // it: under `node --test` on this Linux container the outer shell survives and
  // reports exit code 134, so `result.signal` is null and the test fails —
  // while the identical call under a bare `node` process reports SIGABRT and
  // passes. The test is coupled to the process context, not to the product.
  //
  // The danger is the obvious "fix": relaxing the assertion to accept
  // "exited with code 134" would make the suite green and leave the
  // signal-reporting branch permanently unexercised. This guard makes deleting
  // or reordering that branch loud, independently of which shell runs the test.
  // It is a change-detector on source structure and is documented as such.
  it('FG-M6: the bash tool still reports signals distinctly from exit codes', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'runner', 'tools', 'bash.js'), 'utf8');

    const signalBranch = src.indexOf('if (result.signal)');
    const statusBranch = src.indexOf('if (result.status !== 0)');
    assert.ok(signalBranch !== -1, 'the signal branch was removed — signal deaths would be reported as exit codes');
    assert.ok(statusBranch !== -1, 'the non-zero-exit branch was removed');
    assert.ok(
      signalBranch < statusBranch,
      'the signal check must come BEFORE the status check: a killed process can have status null, ' +
        'so reordering makes signal deaths fall through to the exit-code branch.',
    );
    assert.match(src, /killed by signal/, 'the distinct signal message was removed');
  });

  // FG-M7: the harness's own isolation markers. test/setup.js is what keeps the
  // in-process suite off Alan's real ~/.bridge-runner archive and real trust
  // store. FG-G7 checks the script still LOADS setup.js; nothing checked that
  // setup.js still DOES anything.
  it('FG-M7: the setup shim still installs its isolation markers', () => {
    assert.equal(process.env.BRIDGE_RUNNER_TEST, '1', 'BRIDGE_RUNNER_TEST marker missing — tests may hit real paths');
    assert.equal(process.env.BRIDGE_RUNNER_ARCHIVE, '0', 'archive writes are no longer disabled for tests');

    const setup = fs.readFileSync(path.join(TEST_DIR, 'setup.js'), 'utf8');
    assert.match(setup, /skipTrustGate/, 'the trust-gate bypass moved or was removed — see P0-08');
    assert.match(setup, /__mocks__\/vscode/, 'the vscode mock is no longer loaded before test files');
  });
});
