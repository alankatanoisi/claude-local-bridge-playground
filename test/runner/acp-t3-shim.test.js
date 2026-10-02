'use strict';

/**
 * acp-t3-shim.test.js — argv-shape tests for bin/t3-cursor-shim.sh, the small
 * shell program T3 Code launches when a provider instance points at Bridge
 * Runner.
 *
 * The shim is shell, not JavaScript, so the only way to test it is to run it.
 * We never start the real agent here: BRIDGE_RUNNER_NODE is pointed at a fake
 * "node" (a two-line shell script that prints its own path and every argument
 * on separate lines). Reading that output back tells us exactly what the real
 * agent would have received. The launch shapes below are copied from T3's
 * source (apps/server/src/provider/acp/CursorAcpSupport.ts, 2026-09-26).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHIM = path.resolve(__dirname, '../../bin/t3-cursor-shim.sh');
const AGENT = path.resolve(__dirname, '../../bin/local-bridge-acp.js');

// T3's version gate, mirrored so a future edit to the shim's cliVersion cannot
// silently fall below what T3 accepts (CursorProvider.ts: regex + 2026_04_08).
const T3_VERSION_RE = /^(\d{4})\.(\d{2})\.(\d{2})(?:\b|-|$)/;
const T3_MIN_VERSION_DATE = 20260408;

// A deliberately small PATH: enough for the shim's own helpers (dirname, cd)
// but with none of the machine's real node binaries on it, so every test
// controls node resolution explicitly.
const BASE_ENV = { PATH: '/usr/bin:/bin', HOME: os.homedir() };

describe('bin/t3-cursor-shim.sh (T3 Code launcher)', { skip: process.platform === 'win32' }, () => {
  let tmpDir;
  let fakeNode;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-t3-shim-'));
    fakeNode = path.join(tmpDir, 'node');
    // Prints "$0" then each argument on its own line; exits 0.
    fs.writeFileSync(fakeNode, '#!/bin/sh\nprintf \'%s\\n\' "$0" "$@"\n', { mode: 0o755 });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runShim(args, envOverrides = {}) {
    return spawnSync(SHIM, args, {
      encoding: 'utf8',
      env: { ...BASE_ENV, BRIDGE_RUNNER_NODE: fakeNode, ...envOverrides },
      timeout: 10_000,
    });
  }

  /** The argv the fake node saw: [fakeNodePath, agentPath, ...flags]. */
  function argvOf(result) {
    return result.stdout.split('\n').filter(Boolean);
  }

  it('is executable (T3 spawns it directly, without a shell)', () => {
    const mode = fs.statSync(SHIM).mode;
    assert.notEqual(mode & 0o111, 0, 'shim must carry the exec bit (git mode 100755)');
  });

  for (const args of [['about', '--format', 'json'], ['about']]) {
    it(`answers "${args.join(' ')}" with the identity JSON T3 gates on`, () => {
      const result = runShim(args);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      const about = JSON.parse(result.stdout);
      const match = about.cliVersion.match(T3_VERSION_RE);
      assert.ok(match, 'cliVersion must start with YYYY.MM.DD');
      assert.ok(Number(match[1] + match[2] + match[3]) >= T3_MIN_VERSION_DATE, 'cliVersion below T3 minimum');
      assert.equal(typeof about.userEmail, 'string');
      assert.notEqual(about.userEmail.trim(), '');
      assert.equal(typeof about.subscriptionTier, 'string');
    });
  }

  it('answers "about" with shell built-ins only (works with an empty PATH and no node)', () => {
    const result = spawnSync(SHIM, ['about', '--format', 'json'], {
      encoding: 'utf8',
      env: { PATH: '' },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(typeof JSON.parse(result.stdout).cliVersion, 'string');
  });

  const T3_LAUNCH_SHAPES = [
    ['acp'],
    ['--auto-review', 'acp'],
    ['--force', 'acp'],
    ['-e', 'http://x', 'acp'],
    ['-e', 'http://x', '--force', 'acp'],
  ];
  // T3's Cursor-only launch tokens must never reach the agent. `--allow-shell`
  // used to be in this list too: until 2026-09-28 the shim never forwarded it.
  // That day Alan hand-edited the exec lines to add it (the one deliberate edit
  // the shim's block 5 describes), so the pinned posture below now EXPECTS it.
  // The env-var refusal test further down still guards the other half of the
  // rule: shell can only ever come from this file, never from a setting.
  const NEVER_FORWARDED = ['--force', '--auto-review', '-e', 'http://x', 'acp'];

  for (const shape of T3_LAUNCH_SHAPES) {
    it(`launch shape "${shape.join(' ')}" reaches the agent with only the posture flags`, () => {
      const result = runShim(shape);
      assert.equal(result.status, 0, result.stderr);
      const argv = argvOf(result);
      assert.equal(argv[0], fakeNode);
      assert.equal(argv[1], AGENT);
      assert.ok(argv.includes('--trust-workspace'));
      assert.ok(argv.includes('--allow-shell'), 'shell is on by hand edit since 2026-09-28');
      assert.ok(!argv.includes('--capabilities'), 'no capability groups unless the env var is set');
      for (const token of NEVER_FORWARDED) {
        assert.ok(!argv.includes(token), `T3 token "${token}" must not reach the agent`);
      }
    });

    it(`launch shape "${shape.join(' ')}" adds --capabilities from BRIDGE_RUNNER_CAPABILITIES`, () => {
      const result = runShim(shape, { BRIDGE_RUNNER_CAPABILITIES: 'edits' });
      assert.equal(result.status, 0, result.stderr);
      const argv = argvOf(result);
      assert.equal(argv[0], fakeNode);
      assert.equal(argv[1], AGENT);
      assert.ok(argv.includes('--trust-workspace'));
      // Adding file-write tools must keep the same shell-on posture as the
      // no-capabilities path above; approvals are handled later over ACP.
      assert.ok(argv.includes('--allow-shell'), 'shell stays on when capability groups are configured');
      const at = argv.indexOf('--capabilities');
      assert.notEqual(at, -1);
      assert.equal(argv[at + 1], 'edits');
      for (const token of NEVER_FORWARDED) {
        assert.ok(!argv.includes(token), `T3 token "${token}" must not reach the agent`);
      }
    });
  }

  it('stops loudly on an unknown launch token instead of forwarding it', () => {
    const result = runShim(['--bogus', 'acp']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '', 'the fake node must never have run');
    assert.match(result.stderr, /unexpected argument "--bogus"/);
  });

  it('refuses "shell" in BRIDGE_RUNNER_CAPABILITIES (shell is a hand edit, never an env var)', () => {
    const result = runShim(['acp'], { BRIDGE_RUNNER_CAPABILITIES: 'edits,shell' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '', 'the fake node must never have run');
    assert.match(result.stderr, /shell/);
  });

  it('falls back to the node found on PATH when BRIDGE_RUNNER_NODE is unset', () => {
    const result = spawnSync(SHIM, ['acp'], {
      encoding: 'utf8',
      env: { ...BASE_ENV, PATH: tmpDir + ':' + BASE_ENV.PATH },
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(argvOf(result)[0], fakeNode);
  });

  it('rejects a BRIDGE_RUNNER_NODE that is not executable with a clear message', () => {
    const result = runShim(['acp'], { BRIDGE_RUNNER_NODE: path.join(tmpDir, 'missing-node') });
    assert.equal(result.status, 127);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /BRIDGE_RUNNER_NODE=.*not an executable file/);
  });
});
