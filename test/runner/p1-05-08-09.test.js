'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runnerBin = path.join(__dirname, '../../bin/local-bridge-runner.js');

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [runnerBin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('CLI recovery honesty (P1-09)', () => {
  it('rejects --resume <transcript> at the CLI with a session-store tip', () => {
    const result = runCli(['--resume', '/tmp/fake.jsonl', 'hello']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deprecated and no longer accepted/i);
    assert.match(result.stderr, /resume-session/);
  });

  it('blocks --replay without BRIDGE_RUNNER_EXPERIMENTAL=1', () => {
    const result = runCli(['--replay', '--session-id', 'ses_fake', 'x'], {
      BRIDGE_RUNNER_EXPERIMENTAL: '',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /experimental/i);
  });

  it('blocks --repair without BRIDGE_RUNNER_EXPERIMENTAL=1', () => {
    const result = runCli(['--repair', '--session-id', 'ses_fake', 'x'], {
      BRIDGE_RUNNER_EXPERIMENTAL: '',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /experimental/i);
  });

  it('--continue selects the latest session checkpoint, not a transcript', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'p109-home-'));
    const sessionsDir = path.join(home, '.bridge-runner', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const older = path.join(sessionsDir, 'ses_older.state.json');
    const newer = path.join(sessionsDir, 'ses_newer.state.json');
    fs.writeFileSync(older, JSON.stringify({ schemaVersion: 1, sessionId: 'ses_older', messages: [] }));
    // Ensure newer mtime
    fs.writeFileSync(newer, JSON.stringify({ schemaVersion: 1, sessionId: 'ses_newer', messages: [] }));
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(older, past, past);

    // Will fail later (no bridge / empty messages) but should report continuing from ses_newer.
    const result = runCli(['--continue', '--bridge-url', 'http://127.0.0.1:9/v1/messages', 'continue please'], {
      HOME: home,
      USERPROFILE: home,
    });
    assert.match(result.stderr, /continuing from session .*ses_newer\.state\.json/);
    assert.doesNotMatch(result.stderr, /\.jsonl/);
  });
});

describe('findLatestSessionPath (P1-09)', () => {
  it('returns the newest *.state.json by mtime', () => {
    const { findLatestSessionPath } = require('../../src/runner/session-store');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-latest-'));
    const a = path.join(dir, 'ses_a.state.json');
    const b = path.join(dir, 'ses_b.state.json');
    fs.writeFileSync(a, '{}');
    fs.writeFileSync(b, '{}');
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(a, past, past);
    assert.equal(findLatestSessionPath(dir), b);
  });
});
