'use strict';

/**
 * test-watcher.js — Opt-in watch mode: run the project's test command after
 * every successful write batch and surface failures back into the agent loop.
 *
 * Enabled when ALL of:
 *   - --allow-shell is on (test runs are shell processes)
 *   - BRIDGE_RUNNER_TEST_WATCH=1
 *   - A test command is discoverable (BRIDGE_RUNNER_TEST_CMD or
 *     package.json#scripts.test or pyproject.toml#tool.pytest)
 *
 * Default OFF because test runs can be expensive. When enabled, runs are
 * gated by BRIDGE_RUNNER_TEST_WATCH_BUDGET_MS (default 30000) so a slow
 * suite can't stall the loop.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_BUDGET_MS = 30_000;

function detectTestCommand(cwd) {
  if (!cwd) return null;
  const override = process.env.BRIDGE_RUNNER_TEST_CMD;
  if (override) return { source: 'env', command: override };

  const pkgPath = path.join(cwd, 'package.json');
  try {
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && typeof pkg.scripts.test === 'string') {
        return { source: 'package.json', command: 'npm test --silent' };
      }
    }
  } catch {
    // ignore
  }

  const pyPath = path.join(cwd, 'pyproject.toml');
  try {
    if (fs.existsSync(pyPath)) {
      const txt = fs.readFileSync(pyPath, 'utf8');
      if (/\[tool\.pytest/i.test(txt)) {
        return { source: 'pyproject.toml', command: 'pytest -q' };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function isWatchEnabled(ctx) {
  if (!ctx || !ctx.allowShell) return false;
  if (ctx.testWatch) return true;
  return process.env.BRIDGE_RUNNER_TEST_WATCH === '1';
}

function budgetMs() {
  const env = parseInt(process.env.BRIDGE_RUNNER_TEST_WATCH_BUDGET_MS, 10);
  if (Number.isFinite(env) && env > 0) return env;
  return DEFAULT_BUDGET_MS;
}

/**
 * Run the detected test command synchronously under a budget. Returns
 * { ran: boolean, ok?: boolean, command?, stdout?, stderr?, durationMs?,
 *   reason?: string }.
 */
function runIfEnabled(ctx) {
  if (!isWatchEnabled(ctx)) return { ran: false, reason: 'disabled' };
  const cmd = detectTestCommand(ctx.cwdRealpath || ctx.cwd);
  if (!cmd) return { ran: false, reason: 'no_test_command' };

  const budget = budgetMs();
  const startedAt = Date.now();
  const result = spawnSync(cmd.command, {
    cwd: ctx.cwdRealpath || ctx.cwd,
    shell: true,
    timeout: budget,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const durationMs = Date.now() - startedAt;
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  if (timedOut) {
    return {
      ran: true,
      ok: false,
      command: cmd.command,
      durationMs,
      reason: 'timeout',
      stdout: (result.stdout || '').slice(-2000),
      stderr: (result.stderr || '').slice(-2000),
    };
  }
  return {
    ran: true,
    ok: result.status === 0,
    command: cmd.command,
    source: cmd.source,
    durationMs,
    stdout: (result.stdout || '').slice(-2000),
    stderr: (result.stderr || '').slice(-2000),
    exitCode: result.status,
  };
}

function formatVerificationAppendix(watch) {
  if (!watch || !watch.ran) return '';
  const lines = ['[verification] Ran ' + watch.command + ' (' + (watch.source || 'detected') + ').'];
  if (watch.ok) {
    lines.push('[verification] Tests/checks passed (' + watch.durationMs + ' ms).');
  } else if (watch.reason === 'timeout') {
    lines.push('[verification] Timed out after ' + watch.durationMs + ' ms. Fix or narrow the test command.');
  } else {
    lines.push('[verification] Failed (exit ' + watch.exitCode + '). Review output and fix before finishing.');
  }
  if (watch.stdout && watch.stdout.trim()) lines.push('[stdout]\n' + watch.stdout.trim());
  if (watch.stderr && watch.stderr.trim()) lines.push('[stderr]\n' + watch.stderr.trim());
  return lines.join('\n');
}

module.exports = {
  detectTestCommand,
  isWatchEnabled,
  runIfEnabled,
  formatVerificationAppendix,
  DEFAULT_BUDGET_MS,
};
