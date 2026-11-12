'use strict';

/**
 * persistent-shell-cross-call.test.js — HS-01 follow-up (2026-11-11/12).
 *
 * WHAT THIS GUARDS
 *   The shell scanner (src/runner/shell-policy.js) judges ONE command's text at
 *   a time and models bash's DEFAULT behavior. The optional fast shell path
 *   (BRIDGE_RUNNER_PERSISTENT_SHELL=1, src/runner/tools/persistent-shell.js)
 *   once reused a single bash process for every command, so whatever an
 *   earlier command changed — shell options, the current folder, variables —
 *   was still in force for the next one. State left behind by one PERMITTED
 *   command then changed what a LATER permitted command could read: these
 *   tests returned protected fixture content for dotglob, GLOBIGNORE, cd,
 *   pushd and extglob, and lost the --no-network proxy setting.
 *
 *   Owner decision 2026-11-12: every command gets its own pre-started bash
 *   process, and a used process is never given a second command. These tests
 *   keep that true.
 *
 * WHY THIS IS NOT A REPEAT OF HS-01
 *   HS-01 refuses commands such as `shopt -s dotglob; cat *rc` because the
 *   wildcard and the state change sit in the SAME command. These tests send
 *   the two halves as SEPARATE tool calls. No single call contains both.
 *
 * HOW THE TESTS AVOID PASSING FOR THE WRONG REASON
 *   1. Every sequence runs through the real registry gates (`execute` and
 *      `executeForce`), not through the scanner alone.
 *   2. A spy on PersistentShell.prototype.run proves each call was answered by
 *      the fast shell path and did NOT fall back to the default launcher.
 *   3. An "oracle" asks the machine's real /bin/bash — by FILENAME only, it
 *      never reads file contents — whether carried state really would make
 *      the wildcard reach the protected file. A case that could not leak on
 *      this machine fails loudly instead of quietly reporting success.
 *   4. The same sequences are replayed with the fast path switched off.
 *
 * FIXTURES
 *   Throwaway folders under the system temp directory. The only "secret" is
 *   the synthetic text DISPOSABLE_CROSS_CALL_MARKER. No real credential, home
 *   directory file, or network address is touched.
 *
 * PLATFORM NOTE
 *   The fast path always launches /bin/bash. On a machine without it the
 *   runner falls back to the default launcher, and check 2 above then fails
 *   on purpose: a silent skip would hide the fact that nothing was tested.
 *
 * ASSERTION STYLE
 *   The security assertions say "protected content must not come back", not
 *   "the call must be refused". They would stay valid under a different
 *   design (for example a scanner that tracked state).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { execute, executeForce } = require('../../src/runner/tool-registry');
const persistentShell = require('../../src/runner/tools/persistent-shell');
const { scanShellCommand } = require('../../src/runner/shell-policy');

// Synthetic stand-in for secret file contents. If this text ever appears in a
// tool result, a protected fixture file was read.
const MARKER = 'DISPOSABLE_CROSS_CALL_MARKER';

// Prints the proxy address the runner sets for --no-network, or a fixed word
// when that variable is gone. (`printenv NAME` exits non-zero if NAME is unset.)
const PROXY_PROBE = 'printenv HTTPS_PROXY || echo PROXY_GUARD_GONE';
const UNSET_PROXY = 'unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY';

/**
 * Build a disposable project folder.
 *
 * The project root deliberately holds NO protected file that an ordinary
 * wildcard can see: `.netrc` starts with a dot (hidden from `*` by default)
 * and the private-key name lives one folder down. That is what makes the
 * scanner's default-behavior model say "this wildcard is harmless".
 */
function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pshell-xcall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.netrc'), MARKER + '\n');
  fs.mkdirSync(path.join(dir, 'vault'));
  fs.writeFileSync(path.join(dir, 'vault', 'ID_RSA'), MARKER + '\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'ORDINARY_FILE_MARKER\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'safe.js'), 'SAFE_SOURCE_MARKER\n');
  return { cwd: dir, cwdRealpath: fs.realpathSync(dir), allowShell: true, dontAsk: true, ...extra };
}

/**
 * Switch the fast shell path on or off for one test, starting and ending
 * with no live shell so nothing can travel between tests.
 */
function useShellMode(t, enabled) {
  const saved = process.env.BRIDGE_RUNNER_PERSISTENT_SHELL;
  persistentShell.reset();
  if (enabled) process.env.BRIDGE_RUNNER_PERSISTENT_SHELL = '1';
  else delete process.env.BRIDGE_RUNNER_PERSISTENT_SHELL;
  t.after(() => {
    persistentShell.reset();
    if (saved === undefined) delete process.env.BRIDGE_RUNNER_PERSISTENT_SHELL;
    else process.env.BRIDGE_RUNNER_PERSISTENT_SHELL = saved;
  });
}

/**
 * Send each command as its OWN tool call through a real registry gate.
 *
 * `served` holds what the fast shell path itself reported for every call that
 * reached it. The spy wraps the real method (it never invents an answer), so
 * an empty list means the fast path was not used at all.
 */
async function runSteps(t, run, ctx, commands) {
  const spy = t.mock.method(persistentShell.PersistentShell.prototype, 'run');
  const results = [];
  for (const command of commands) results.push(await run('bash', { command }, ctx));
  const served = await Promise.all(spy.mock.calls.map((call) => call.result));
  spy.mock.restore();
  // Printed in the test report so a failure names the exact call that leaked.
  t.diagnostic(
    JSON.stringify({
      gate: run.name,
      calls: commands.map((command, i) => ({
        command,
        ok: results[i].ok,
        markerReturned: results[i].text.includes(MARKER),
        rule: results[i].permission ? results[i].permission.ruleId : null,
      })),
      servedByPersistentShell: served.length,
    }),
  );
  return { results, served };
}

/** True when the permission gate refused the call before any shell saw it. */
function refusedByGate(result) {
  return Boolean(result.permission && result.permission.decision === 'deny');
}

/**
 * Every call that got past the gate must have been answered by the fast shell
 * path, with no fallback to the default launcher. Without this, a "no leak"
 * result could simply mean the path under test was never exercised.
 *
 * `finalCallMayFallBack` exists for the split cases only. Because state does
 * not carry over, the final read can legitimately make bash exit (`@(...)` is
 * a syntax error when extglob is not on), and the runner then retries it with
 * the default launcher. That is a safe outcome, so only the state-SETTING
 * calls are required to be served here.
 */
function assertServedByPersistentShell({ results, served }, { finalCallMayFallBack = false } = {}) {
  const reachedShell = results.map((_, i) => i).filter((i) => !refusedByGate(results[i]));
  assert.equal(served.length, reachedShell.length, 'every permitted call must go through the fast shell path');
  served.forEach((outcome, n) => {
    if (finalCallMayFallBack && reachedShell[n] === results.length - 1) return;
    assert.equal(outcome.ok, true, 'fast shell path fell back to the default launcher: ' + outcome.reason);
  });
}

function assertNoMarker({ results }, commands) {
  const leaked = commands.filter((_, i) => results[i].text.includes(MARKER));
  assert.deepEqual(leaked, [], 'protected fixture content was returned by these calls');
}

/**
 * Ask real bash which FILENAMES a wildcard expands to after the setup lines.
 *
 * Commands are fed line by line on standard input to ONE bash — which is how
 * a reused shell would receive them. `printf` prints names only; no protected
 * file is opened. This independently confirms that carried state WOULD be
 * dangerous on this machine's bash version, so the assertions are never vacuous.
 */
function bashExpansion(ctx, setup, pattern) {
  return childProcess.execFileSync('/bin/bash', ['--norc', '--noprofile'], {
    cwd: ctx.cwd,
    input: [...setup, "printf '%s\\n' " + pattern, ''].join('\n'),
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin' },
    timeout: 10000,
  });
}

// Each case splits a shape that HS-01 refuses inside ONE command into separate
// calls. `setup` changes shell state; `cat <pattern>` is the later read.
//   expands     — protected name the oracle must see in bash's own expansion
//   oneCallForm — the equivalent single command; the scanner must refuse it,
//                 which proves the case is a split of an already-denied shape
const splitCases = [
  {
    // dotglob makes `*` match hidden dot-files such as .netrc.
    setup: ['shopt -s dotglob'],
    pattern: '*rc',
    expands: '.netrc',
    oneCallForm: 'shopt -s dotglob; cat *rc',
  },
  {
    // Setting GLOBIGNORE to anything switches dot-file matching on as a side effect.
    setup: ['GLOBIGNORE=x'],
    pattern: '*rc',
    expands: '.netrc',
    oneCallForm: 'GLOBIGNORE=x; cat *rc',
  },
  {
    // The scanner expands wildcards from the project root; bash expands them
    // from wherever an earlier `cd` left it.
    setup: ['cd vault'],
    pattern: '*',
    expands: 'ID_RSA',
    oneCallForm: 'cd vault; cat *',
  },
  {
    // pushd is another way to change the current folder.
    setup: ['pushd vault'],
    pattern: '*',
    expands: 'ID_RSA',
    oneCallForm: 'pushd vault; cat *',
  },
  {
    // extglob adds pattern syntax, @(...), that the scanner does not treat as
    // a wildcard at all. It only takes effect for lines read AFTER it is set,
    // so its denied single-command equivalent is the `bash -O` spelling.
    setup: ['shopt -s extglob'],
    pattern: 'vault/ID_@(RSA)',
    expands: 'vault/ID_RSA',
    oneCallForm: "bash -O extglob -c 'cat vault/ID_@(RSA)'",
  },
  {
    // nocaseglob makes patterns ignore upper/lower case. The scanner already
    // checks both spellings, so this split is refused today; it is pinned here
    // so that protection cannot quietly regress across calls.
    setup: ['shopt -s nocaseglob'],
    pattern: 'vault/id_rs?',
    expands: 'vault/ID_RSA',
    oneCallForm: 'shopt -s nocaseglob; cat vault/id_rs?',
  },
];

describe('persistent shell: test harness validity', () => {
  it('with the opt-in on, each call is served by the fast path in its own process and nothing carries over', async (t) => {
    // Until 2026-11-12 this test asserted the opposite (one shared process,
    // variable carried over) as the precondition for the leaks below. It was
    // replaced on purpose when the owner chose one process per command. If it
    // fails with "[carried]" or an identical process id, a used shell is being
    // reused again — that reopens every case in the next describe block.
    useShellMode(t, true);
    const ctx = fixture(t);
    const outcome = await runSteps(t, execute, ctx, [
      'echo $$', // $$ is the process id of the shell reading the command
      'PSHELL_CANARY=carried; cd src',
      'echo "$$ [${PSHELL_CANARY:-absent}] $PWD"',
    ]);
    assertServedByPersistentShell(outcome);
    assert.equal(outcome.served.length, 3, 'all three calls must use the fast path, not the default launcher');
    const firstPid = outcome.results[0].text.trim();
    assert.match(firstPid, /^\d+$/);
    const [lastPid, canary, folder] = outcome.results[2].text.trim().split(' ');
    assert.match(lastPid, /^\d+$/);
    assert.notEqual(lastPid, firstPid, 'a used bash process must never run a second command');
    assert.equal(canary, '[absent]', 'a variable set by an earlier call must not be visible');
    assert.equal(folder, ctx.cwdRealpath, 'an earlier `cd` must not move a later call');
  });

  it('control: with the opt-in off, each call is an independent subprocess and nothing carries over', async (t) => {
    useShellMode(t, false);
    const ctx = fixture(t);
    const outcome = await runSteps(t, execute, ctx, ['PSHELL_CANARY=carried', 'echo "[${PSHELL_CANARY:-absent}]"']);
    assert.equal(outcome.served.length, 0, 'the persistent shell must not be used when the opt-in is off');
    assert.equal(outcome.results[1].text.trim(), '[absent]');
  });
});

describe('persistent shell: state from one call must not widen a later read', () => {
  for (const { setup, pattern, expands, oneCallForm } of splitCases) {
    const commands = [...setup, 'cat ' + pattern];
    for (const run of [execute, executeForce]) {
      it(run.name + ' returns no protected content for the separate calls ' + JSON.stringify(commands), async (t) => {
        useShellMode(t, true);
        const ctx = fixture(t);
        // Validity: on this machine, the state really does steer the wildcard
        // onto the protected file, and the one-command spelling is refused.
        assert.ok(
          bashExpansion(ctx, setup, pattern).includes(expands),
          'oracle: bash did not expand ' + pattern + ' to ' + expands + ' — this case tests nothing here',
        );
        assert.equal(scanShellCommand(oneCallForm, ctx).allowed, false, 'the single-command form must be refused');

        const outcome = await runSteps(t, run, ctx, commands);
        assertServedByPersistentShell(outcome, { finalCallMayFallBack: true });
        assertNoMarker(outcome, commands);
      });
    }
  }

  it('execute keeps the --no-network proxy setting for a later call after a separate call unset it', async (t) => {
    // Best-effort guard, not OS isolation: under --no-network the runner
    // points proxy variables at a dead local address for EVERY command. This
    // asserts the later command still starts with that same environment.
    useShellMode(t, true);
    const ctx = fixture(t, { noNetwork: true });
    const baseline = await runSteps(t, execute, ctx, [PROXY_PROBE]);
    assertServedByPersistentShell(baseline);
    assert.equal(baseline.results[0].text.trim(), '127.0.0.1:1', 'validity: the guard is present to begin with');

    const outcome = await runSteps(t, execute, ctx, [UNSET_PROXY, PROXY_PROBE]);
    assertServedByPersistentShell(outcome);
    assert.equal(outcome.results[1].text.trim(), '127.0.0.1:1', 'a later call lost the no-network proxy setting');
  });

  it('control: the same sequences are harmless when every call is an independent subprocess', async (t) => {
    // Any difference from the tests above is therefore caused by carried
    // state, not by the scanner or the fixture.
    useShellMode(t, false);
    for (const { setup, pattern } of splitCases) {
      const commands = [...setup, 'cat ' + pattern];
      const outcome = await runSteps(t, execute, fixture(t), commands);
      assert.equal(outcome.served.length, 0);
      assertNoMarker(outcome, commands);
    }
    const proxy = await runSteps(t, execute, fixture(t, { noNetwork: true }), [UNSET_PROXY, PROXY_PROBE]);
    assert.equal(proxy.served.length, 0);
    assert.equal(proxy.results[1].text.trim(), '127.0.0.1:1');
  });
});

describe('persistent shell: legitimate work is not refused (false-positive controls)', () => {
  for (const run of [execute, executeForce]) {
    it(run.name + ' still serves ordinary commands around harmless and glob-related state', async (t) => {
      useShellMode(t, true);

      // Each sequence gets its own throwaway folder.
      // 1. A harmless variable must not make an ordinary project wildcard suspicious.
      let ctx = fixture(t);
      let commands = ['export PSHELL_CANARY=1', 'cat src/*.js'];
      let outcome = await runSteps(t, run, ctx, commands);
      assertServedByPersistentShell(outcome);
      assertNoMarker(outcome, commands);
      assert.equal(outcome.results[1].ok, true, outcome.results[1].text);
      assert.match(outcome.results[1].text, /SAFE_SOURCE_MARKER/);

      // 2. After a glob option was set, ordinary reads with no protected match
      //    must keep working. Only the LATER calls are asserted: a fix is free
      //    to refuse the `shopt` call itself.
      ctx = fixture(t);
      commands = ['shopt -s dotglob', 'cat README.md', 'cat src/*.js'];
      outcome = await runSteps(t, run, ctx, commands);
      assertServedByPersistentShell(outcome);
      assertNoMarker(outcome, commands);
      assert.equal(outcome.results[1].ok, true, outcome.results[1].text);
      assert.match(outcome.results[1].text, /ORDINARY_FILE_MARKER/);
      assert.equal(outcome.results[2].ok, true, outcome.results[2].text);
      assert.match(outcome.results[2].text, /SAFE_SOURCE_MARKER/);

      // 3. Changing folder and reading an ordinary file inside ONE command.
      ctx = fixture(t);
      commands = ['cd src && cat safe.js'];
      outcome = await runSteps(t, run, ctx, commands);
      assertServedByPersistentShell(outcome);
      assert.equal(outcome.results[0].ok, true, outcome.results[0].text);
      assert.match(outcome.results[0].text, /SAFE_SOURCE_MARKER/);

      // 4. After a folder change in an earlier call, an ordinary read by full
      //    path must still work.
      ctx = fixture(t);
      commands = ['cd src', 'cat ' + path.join(ctx.cwdRealpath, 'README.md')];
      outcome = await runSteps(t, run, ctx, commands);
      assertServedByPersistentShell(outcome);
      assert.equal(outcome.results[1].ok, true, outcome.results[1].text);
      assert.match(outcome.results[1].text, /ORDINARY_FILE_MARKER/);
    });
  }
});

describe('persistent shell: a cut-off call and a new folder also start clean', () => {
  it('a timed-out call is killed and the next call still gets a clean shell', async (t) => {
    useShellMode(t, true);
    const ctx = fixture(t, { shellTimeout: 1000 });
    const commands = ['shopt -s dotglob', 'sleep 3', 'shopt -q dotglob; echo dotglob_status=$?', 'cat *rc'];
    const outcome = await runSteps(t, execute, ctx, commands);
    assertServedByPersistentShell(outcome);
    assert.match(outcome.results[1].text, /timed out/);
    // `shopt -q NAME` exits 1 when the option is off.
    assert.equal(outcome.results[2].text.trim(), 'dotglob_status=1');
    assertNoMarker(outcome, commands);
  });

  it('a different working folder gets a new shell instead of inheriting the previous one', async (t) => {
    useShellMode(t, true);
    const first = await runSteps(t, execute, fixture(t), ['shopt -s dotglob; echo $$']);
    assertServedByPersistentShell(first);
    const commands = ['shopt -q dotglob; echo dotglob_status=$? pid=$$', 'cat *rc'];
    const second = await runSteps(t, execute, fixture(t), commands);
    assertServedByPersistentShell(second);
    const firstPid = first.results[0].text.trim();
    assert.match(firstPid, /^\d+$/);
    assert.match(second.results[0].text, /^dotglob_status=1 pid=\d+$/);
    assert.notEqual(second.results[0].text.trim(), 'dotglob_status=1 pid=' + firstPid, 'must be a different process');
    assertNoMarker(second, commands);
  });
});
