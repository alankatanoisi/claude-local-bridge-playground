#!/usr/bin/env node
'use strict';

/**
 * mutation-check.js — "do our tests actually bite?"
 *
 * WHY THIS EXISTS
 * ---------------
 * A green test suite proves that the tests *ran*. It does not prove that the
 * tests would have *noticed* if the code were wrong. A test that asserts
 * nothing meaningful passes just as green as a test that guards a real
 * invariant.
 *
 * Mutation testing closes that loop. For each entry below we:
 *   1. back the source file up (to the OS temp dir, never to git),
 *   2. deliberately break one invariant with a surgical string replacement,
 *   3. run only the test file that CLAIMS to guard that invariant,
 *   4. record whether that test file went red,
 *   5. restore the original bytes.
 *
 * A mutation that survives (tests still green while the code is broken) is a
 * FALSE GREEN and is reported as such. That is the actual finding this script
 * is built to produce.
 *
 * SAFETY NOTES (this repo has concurrent agents editing the same checkout):
 *   - Restore is done from a byte-for-byte temp copy, NOT `git checkout --`,
 *     so we never touch git state or clobber anybody else's uncommitted work.
 *   - Restore runs in a `finally` block, and we also restore on SIGINT/SIGTERM,
 *     so an interrupted run does not leave mutated source on disk.
 *   - A post-run integrity check re-hashes every touched file and shouts if any
 *     file does not match its original hash.
 *
 * USAGE
 *   node scripts/mutation-check.js            # run every mutation
 *   node scripts/mutation-check.js FG-A1      # run one by id
 *   node scripts/mutation-check.js --list     # show the catalog, change nothing
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

/**
 * The mutation catalog.
 *
 * `find` must match EXACTLY ONCE in the file — if it matches zero times the
 * source has drifted and the mutation is reported as STALE (itself a useful
 * signal: the guard test may now be guarding nothing). If it matches more than
 * once we refuse rather than guess.
 *
 * `expectRedIn` is the test file that is supposed to catch this break.
 */
const MUTATIONS = [
  {
    id: 'M1-denydir-gnupg',
    why: 'Drops .gnupg from the blocked-directory list — a plausible "tidy up the list" edit.',
    file: 'src/runner/safety.js',
    find: "'.gnupg',",
    replace: '',
    expectRedIn: 'test/runner/false-green-deny-matrix.test.js',
  },
  {
    id: 'M2-env-case-flag',
    why: 'Removes the /i flag from the env-file pattern, re-introducing a case bypass.',
    file: 'src/runner/safety.js',
    find: '/^\\.env/i,',
    replace: '/^\\.env/,',
    expectRedIn: 'test/runner/false-green-deny-matrix.test.js',
  },
  {
    id: 'M3-secret-pattern',
    why: 'Deletes the generic /secret/i basename rule — the broadest catch-all.',
    file: 'src/runner/safety.js',
    find: '/secret/i,',
    replace: '',
    expectRedIn: 'test/runner/false-green-deny-matrix.test.js',
  },
  {
    id: 'M4-plan-write-escape',
    why: 'Lets plan mode actually write, breaking the "plan never mutates" invariant.',
    file: 'src/runner/permissions.js',
    find: "    write: 'plan_only',",
    replace: "    write: 'allow',",
    expectRedIn: 'test/runner/false-green-permission-matrix.test.js',
  },
  {
    id: 'M5-plan-shell-escape',
    why: 'Lets plan mode run shell — the most dangerous single-word regression here.',
    file: 'src/runner/permissions.js',
    find: "    shell: 'plan_only',",
    replace: "    shell: 'allow',",
    expectRedIn: 'test/runner/false-green-permission-matrix.test.js',
  },
  {
    id: 'M6-shell-gate',
    why: 'Removes the allowShell gate so shell tools are reachable without the flag.',
    file: 'src/runner/permissions.js',
    find: "if (category === 'shell' && !eff.allowShell) {",
    replace: "if (category === 'shell' && false) {",
    expectRedIn: 'test/runner/false-green-permission-matrix.test.js',
  },
  {
    id: 'M7-unknown-tool-allow',
    why: 'Turns the unknown-tool hard deny into a soft allow (fail-open regression).',
    file: 'src/runner/permissions.js',
    find: '  if (!category) {',
    replace: '  if (false) {',
    expectRedIn: 'test/runner/false-green-permission-matrix.test.js',
  },
];

// --- helpers ---------------------------------------------------------------

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest(testFile) {
  // We shell out to the same runner the npm script uses so we exercise the
  // real setup shim. Non-zero exit === the test file went red.
  try {
    execFileSync(
      process.execPath,
      ['--require', './test/setup.js', '--test', testFile],
      { cwd: REPO, stdio: 'pipe', timeout: 180000 }
    );
    return { red: false };
  } catch (err) {
    const out = String((err.stdout || '') + (err.stderr || ''));
    // Distinguish "assertions failed" from "the file blew up on require".
    const crashed = /Cannot find module|SyntaxError|ReferenceError/.test(out) && !/^# fail [1-9]/m.test(out);
    return { red: true, crashed, out };
  }
}

// --- main ------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  for (const m of MUTATIONS) console.log(`${m.id.padEnd(24)} ${m.file}  -> ${m.expectRedIn}`);
  process.exit(0);
}
const only = argv.filter((a) => !a.startsWith('-'));
const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

// `--against=<testfile>` re-points every selected mutation at a DIFFERENT test
// file. This is how we measure the marginal value of the new false-green files:
// point the same mutation at the pre-existing tests and see whether it SURVIVES
// there. A mutation that is CAUGHT by the new file but SURVIVES against the old
// ones is precisely the regression class the new file was written to close.
const againstArg = argv.find((a) => a.startsWith('--against='));
if (againstArg) {
  const target = againstArg.slice('--against='.length);
  for (const m of selected) m.expectRedIn = target;
}

// Track every file we touch so we can prove we put it back exactly.
/** @type {Map<string,{abs:string, backup:string, hash:string}>} */
const touched = new Map();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-check-'));

function backup(relFile) {
  if (touched.has(relFile)) return touched.get(relFile);
  const abs = path.join(REPO, relFile);
  const original = fs.readFileSync(abs);
  const backupPath = path.join(tmpDir, relFile.replace(/[\\/]/g, '__'));
  fs.writeFileSync(backupPath, original);
  const rec = { abs, backup: backupPath, hash: sha(original) };
  touched.set(relFile, rec);
  return rec;
}

function restoreAll() {
  for (const [rel, rec] of touched) {
    try {
      fs.writeFileSync(rec.abs, fs.readFileSync(rec.backup));
      const now = sha(fs.readFileSync(rec.abs));
      if (now !== rec.hash) console.error(`!! INTEGRITY: ${rel} did not restore cleanly`);
    } catch (e) {
      console.error(`!! FAILED TO RESTORE ${rel}: ${e.message}`);
    }
  }
}

// Restore even if the user interrupts us mid-mutation.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130); });

const results = [];
try {
  for (const m of selected) {
    const rec = backup(m.file);
    const original = fs.readFileSync(rec.abs, 'utf8');
    const occurrences = original.split(m.find).length - 1;

    if (occurrences !== 1) {
      results.push({ ...m, verdict: occurrences === 0 ? 'STALE' : 'AMBIGUOUS', occurrences });
      console.log(`[${occurrences === 0 ? 'STALE' : 'AMBIG'}] ${m.id} — anchor matched ${occurrences}x`);
      continue;
    }

    fs.writeFileSync(rec.abs, original.replace(m.find, m.replace));
    const { red, crashed } = runTest(m.expectRedIn);
    fs.writeFileSync(rec.abs, original); // restore immediately, before the next mutation

    const verdict = crashed ? 'INCONCLUSIVE(crash)' : red ? 'CAUGHT' : 'SURVIVED';
    results.push({ ...m, verdict });
    const mark = verdict === 'CAUGHT' ? 'ok  ' : 'FALSE-GREEN';
    console.log(`[${mark}] ${m.id} — ${verdict} — ${m.expectRedIn}`);
  }
} finally {
  restoreAll();
}

const survived = results.filter((r) => r.verdict === 'SURVIVED');
const stale = results.filter((r) => r.verdict === 'STALE' || r.verdict === 'AMBIGUOUS');
console.log(`\n--- ${results.length} mutations: ` +
  `${results.filter((r) => r.verdict === 'CAUGHT').length} caught, ` +
  `${survived.length} survived (false green), ${stale.length} stale/ambiguous ---`);
for (const s of survived) console.log(`  FALSE GREEN: ${s.id} — ${s.why}`);
for (const s of stale) console.log(`  STALE ANCHOR: ${s.id} — source drifted; guard may be dead`);

process.exit(survived.length > 0 ? 1 : 0);
