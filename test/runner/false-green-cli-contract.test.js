'use strict';

/**
 * false-green-cli-contract.test.js — real-CLI subprocess contract (FG-E).
 *
 * Almost every runner test imports library modules directly, and test/setup.js
 * patches run() with skipTrustGate:true for the whole in-process suite. That
 * means two things can regress with the suite fully green:
 *   1. CLI wiring (flag parsing, early validation, exit codes) — never
 *      exercised end-to-end except by the crash bakeoff tests.
 *   2. The workspace trust gate — bypassed by the harness in every in-process
 *      test, by design (P0-08).
 * These tests spawn the real bin/local-bridge-runner.js as a child process, so
 * neither bypass applies.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUNNER_BIN = path.join(__dirname, '..', '..', 'bin', 'local-bridge-runner.js');
const SPAWN_TIMEOUT_MS = 20000;

// Child env: drop the harness markers so the child behaves like a real user
// invocation, point HOME at a throwaway dir so Alan's real trust store is
// never read or written, and aim the bridge URL at a dead port so no test can
// accidentally reach a live bridge.
function childEnv(tmpHome) {
  const env = { ...process.env };
  delete env.BRIDGE_RUNNER_TEST;
  delete env.BRIDGE_RUNNER_ARCHIVE;
  env.HOME = tmpHome;
  env.BRIDGE_RUNNER_BRIDGE_URL = 'http://127.0.0.1:9';
  return env;
}

function runCli(args, opts = {}) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-cli-home-'));
  const cwd = opts.cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'fg-cli-cwd-'));
  const result = spawnSync(process.execPath, [RUNNER_BIN, ...args], {
    cwd,
    env: childEnv(tmpHome),
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
  });
  return { ...result, combined: String(result.stdout || '') + String(result.stderr || ''), cwd };
}

describe('FG-E CLI flag-surface contract', () => {
  it('FG-E1: --help exits 0 and shows the runner banner', () => {
    const r = runCli(['--help']);
    assert.equal(r.status, 0, '--help must exit 0; output was: ' + r.combined.slice(0, 400));
    assert.match(r.combined, /local-bridge-runner/);
  });

  it('FG-E2: an unknown flag is rejected with a non-zero exit (strict parsing lock)', () => {
    // If arg parsing ever switches to non-strict, typo'd safety flags like
    // --acept-edits would be silently ignored — the worst kind of false green
    // for a novice operator. Lock strictness at the process boundary.
    const r = runCli(['--definitely-not-a-real-flag', 'hello']);
    assert.notEqual(r.status, 0, 'unknown flags must fail the process');
    assert.match(r.combined, /definitely-not-a-real-flag|unknown option|Unknown/i);
  });

  // FG-E3 (retired --agent/--profile flags) intentionally absent here:
  // test/runner/profiles-retired.test.js already covers that at the process
  // boundary, including help-text absence. Kept there as the single owner.

  it('FG-E4: --capabilities shell is refused with pointer to --allow-shell', () => {
    const r = runCli(['--capabilities', 'shell', 'hi']);
    assert.notEqual(r.status, 0);
    assert.match(r.combined, /allow-shell/i, 'refusal must teach the correct consent flag');
  });

  it('FG-E5: the chaos flag combo is refused without --chaos-ok', () => {
    const r = runCli(['--allow-shell', '--accept-edits', '--dont-ask', 'hi']);
    assert.notEqual(r.status, 0);
    assert.match(r.combined, /chaos-ok/i);
  });
});

describe('FG-E workspace trust gate (no harness bypass)', () => {
  it('FG-E6: an untrusted cwd is refused in non-interactive mode before any model call', () => {
    // The in-process suite always sets skipTrustGate — this is the one place
    // the real gate runs. The dead bridge URL doubles as a tripwire: if the
    // child got far enough to attempt a request, the error would be a network
    // error, not a trust error, and the assertion below would fail.
    const r = runCli(['hello from an untrusted workspace']);
    assert.notEqual(r.status, 0, 'untrusted cwd must refuse to run');
    assert.match(r.combined, /trust/i, 'refusal must mention workspace trust; got: ' + r.combined.slice(0, 400));
  });

  it('FG-E7: --trust-workspace consents headlessly and the failure moves past trust to transport', () => {
    const r = runCli(['--trust-workspace', 'hello']);
    assert.notEqual(r.status, 0, 'dead bridge must still fail the run');
    assert.doesNotMatch(r.combined, /workspace is not trusted|not trusted/i, 'trust consent flag must clear the gate');
    // The next failure should be transport-shaped (bridge unreachable), which
    // proves ordering: trust gate first, network second.
    assert.match(r.combined, /bridge|connect|ECONNREFUSED|network/i, 'expected a transport error after trust cleared');
  });
});
