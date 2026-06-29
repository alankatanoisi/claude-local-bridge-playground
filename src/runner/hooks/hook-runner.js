'use strict';

/**
 * hook-runner.js — Execute trusted hook commands with shell-policy scanning.
 */

const { spawnSync } = require('child_process');
const safety = require('../safety');
const { scanShellCommand } = require('../shell-policy');

const DEFAULT_HOOK_TIMEOUT_MS = 120_000;
const MAX_HOOK_OUTPUT_CHARS = 8000;

function buildHookEnv(ctx) {
  const env = safety.buildSafeEnv();
  if (ctx?.noNetwork) {
    env.http_proxy = '127.0.0.1:1';
    env.https_proxy = '127.0.0.1:1';
    env.HTTP_PROXY = '127.0.0.1:1';
    env.HTTPS_PROXY = '127.0.0.1:1';
  }
  return env;
}

function executeHookCommand(hook, ctx, payload = {}) {
  const command = String(hook.command || '').trim();
  if (!command) {
    return { ok: false, action: hook.action || 'exec', error: 'Hook missing command string.' };
  }

  const scan = scanShellCommand(command, ctx || {});
  if (!scan.allowed) {
    const first = scan.issues[0];
    const detail = first
      ? first.kind === 'hard_deny_path'
        ? 'blocked path pattern: ' + first.segment
        : first.kind === 'blocked_path_pattern'
          ? 'blocked path pattern: ' + (first.token || first.segment)
          : first.kind
      : 'shell policy violation';
    return { ok: false, action: hook.action || 'exec', error: 'Hook command blocked: ' + detail };
  }

  const cwd = ctx?.cwdRealpath || ctx?.cwd || process.cwd();
  const timeout = Math.min(Number(hook.timeout_ms) || DEFAULT_HOOK_TIMEOUT_MS, DEFAULT_HOOK_TIMEOUT_MS);
  const result = spawnSync(command, [], {
    cwd,
    env: buildHookEnv(ctx),
    shell: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = ((result.stdout || '') + (result.stderr ? '\n[stderr]\n' + result.stderr : '')).trim();
  if (output.length > MAX_HOOK_OUTPUT_CHARS) {
    output = output.slice(0, MAX_HOOK_OUTPUT_CHARS) + '\n... [hook output truncated]';
  }
  output = safety.scrubSecrets(output);

  const ok = !result.error && result.status === 0 && !result.signal;
  return {
    ok,
    action: hook.action || 'exec',
    command,
    exitCode: result.status,
    signal: result.signal,
    output,
    event: payload.event,
    tool: payload.tool,
    error: ok ? null : result.error?.message || 'Hook exited with code ' + result.status,
  };
}

module.exports = {
  DEFAULT_HOOK_TIMEOUT_MS,
  executeHookCommand,
};
