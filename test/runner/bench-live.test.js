'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const BENCH = path.resolve(__dirname, 'bench/turn-latency.bench.js');
const SETUP = path.resolve(__dirname, '../setup.js');

describe('E2 bench --live guardrails', () => {
  it('refuses an unknown model with a non-zero exit code', () => {
    const r = spawnSync(process.execPath, ['--require', SETUP, BENCH, '--live', '--model', 'totally-not-a-model'], {
      encoding: 'utf8',
      env: { ...process.env, BRIDGE_BENCH_LIVE_MAX_USD: '0.50' },
    });
    assert.notEqual(r.status, 0, 'should exit non-zero');
    assert.match(r.stderr, /--live requires --model from/);
  });

  it('refuses --live with no --model argument', () => {
    const r = spawnSync(process.execPath, ['--require', SETUP, BENCH, '--live'], {
      encoding: 'utf8',
      env: { ...process.env, BRIDGE_BENCH_LIVE_MAX_USD: '0.50' },
    });
    assert.notEqual(r.status, 0);
  });

  it('stubbed mode still runs without --live', () => {
    const r = spawnSync(process.execPath, ['--require', SETUP, BENCH, '--runs', '1', '--steps', '2', '--json'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.runs, 1);
    assert.equal(report.live, undefined, 'no live block in stubbed mode');
  });
});
