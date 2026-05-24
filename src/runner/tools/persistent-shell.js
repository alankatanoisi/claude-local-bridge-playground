'use strict';

/**
 * persistent-shell.js — Long-lived bash process for the runner.
 *
 * Spawning a fresh shell per bash call costs ~30–100ms each on Linux. A
 * coding agent that fires bash dozens of times per session pays that
 * tax over and over. This module keeps a single bash child process alive
 * and routes individual commands through it using a sentinel line for
 * framing.
 *
 * Status: opt-in. The bash tool only enables this path when the env var
 * BRIDGE_RUNNER_PERSISTENT_SHELL=1 is set. Default behavior (spawnSync
 * per call) is unchanged. This lets us measure the win and shake out
 * edge cases before flipping the default.
 *
 * Safety notes:
 *   - All shell-policy / permissions checks run upstream of this module
 *     (see tool-registry.js, permissions.js, shell-policy.js). By the
 *     time a command reaches the persistent shell it has already been
 *     gated and is approved to execute.
 *   - Per-call timeout kills the shell and forces a respawn — no chance
 *     of a hung command starving subsequent calls.
 *   - Per-call output cap also kills + respawns, so a runaway command
 *     can't OOM the runner.
 *   - The shell is spawned with the same safety.buildSafeEnv() that
 *     spawnSync uses, so env scrubbing applies equally.
 *   - If the env/cwd a caller passes does not match the live shell, we
 *     respawn rather than leak state across contexts.
 */

const { spawn } = require('child_process');

const SENTINEL_PREFIX = '__BRIDGE_RUNNER_SH_END__';
const HARD_OUTPUT_CAP = 10 * 1024 * 1024;

function envKey(env) {
  // Cheap fingerprint so we know when to respawn. Stringifying the env
  // every call is fine — it's small and only runs when bash is invoked.
  return JSON.stringify(env);
}

class PersistentShell {
  constructor(opts) {
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.envKey = envKey(opts.env);
    this.child = null;
    this.busy = false;
    this.counter = 0;
    this.lastError = null;
  }

  _spawn() {
    // --norc / --noprofile keeps startup deterministic. -i would enable
    // job control noise; we leave it off and rely on the sentinel.
    this.child = spawn('/bin/bash', ['--norc', '--noprofile'], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Don't let the persistent shell keep the parent process alive. If
    // the parent exits without an explicit shutdown(), bash inherits the
    // EOF on its stdin and exits on its own.
    this.child.unref();
    if (this.child.stdout) this.child.stdout.unref();
    if (this.child.stderr) this.child.stderr.unref();
    if (this.child.stdin) this.child.stdin.unref();
    this.child.on('error', (err) => {
      this.lastError = err;
      this.child = null;
    });
    this.child.on('exit', () => {
      this.child = null;
    });
  }

  isAlive() {
    return !!(this.child && this.child.exitCode === null && !this.child.killed);
  }

  matches(cwd, env) {
    return this.cwd === cwd && this.envKey === envKey(env);
  }

  shutdown() {
    if (this.child) {
      try {
        // Closing stdin lets bash exit cleanly on EOF; the kill is a
        // belt-and-suspenders escalation for the rare case where bash
        // is blocked on something other than its input.
        if (this.child.stdin && !this.child.stdin.destroyed) this.child.stdin.end();
        this.child.kill('SIGTERM');
      } catch {
        // already gone
      }
      this.child = null;
    }
    this.busy = false;
  }

  run(command, opts = {}) {
    const timeout = opts.timeout || 30000;
    const maxBytes = opts.maxBytes || HARD_OUTPUT_CAP;

    return new Promise((resolve) => {
      if (this.busy) {
        // Don't queue — fall back to a fresh shell rather than serialize
        // against the existing call. Callers can retry on the spawnSync
        // fallback path.
        resolve({ ok: false, fallback: true, reason: 'busy' });
        return;
      }
      if (!this.isAlive()) {
        try {
          this._spawn();
        } catch (err) {
          resolve({ ok: false, fallback: true, reason: 'spawn_failed:' + err.message });
          return;
        }
      }
      if (!this.isAlive()) {
        resolve({ ok: false, fallback: true, reason: 'shell_not_alive' });
        return;
      }
      this.busy = true;
      this.counter++;

      const sentinel = SENTINEL_PREFIX + this.counter + '__';
      const sentinelRe = new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(-?\\d+)__');

      let stdout = '';
      let stderr = '';
      let resolved = false;
      let timedOut = false;
      let overflowed = false;

      const child = this.child;

      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.removeListener('data', onStdout);
        child.stderr.removeListener('data', onStderr);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        this.busy = false;
      };

      const finishWithSentinel = (match) => {
        if (resolved) return;
        resolved = true;
        const exitCode = parseInt(match[1], 10);
        stdout = stdout.slice(0, match.index);
        cleanup();
        resolve({
          ok: true,
          stdout,
          stderr,
          exitCode,
          timedOut,
          overflowed,
        });
      };

      const killAndRespawn = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        this.child = null;
        this.busy = false;
      };

      const onStdout = (chunk) => {
        if (resolved) return;
        stdout += chunk.toString('utf8');
        if (stdout.length + stderr.length > maxBytes) {
          overflowed = true;
          resolved = true;
          cleanup();
          killAndRespawn();
          resolve({
            ok: true,
            stdout: stdout.slice(0, maxBytes),
            stderr,
            exitCode: null,
            timedOut: false,
            overflowed: true,
          });
          return;
        }
        const match = stdout.match(sentinelRe);
        if (match) finishWithSentinel(match);
      };

      const onStderr = (chunk) => {
        if (resolved) return;
        stderr += chunk.toString('utf8');
        if (stdout.length + stderr.length > maxBytes) {
          overflowed = true;
          resolved = true;
          cleanup();
          killAndRespawn();
          resolve({
            ok: true,
            stdout,
            stderr: stderr.slice(0, maxBytes),
            exitCode: null,
            timedOut: false,
            overflowed: true,
          });
        }
      };

      const onExit = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this.child = null;
        resolve({ ok: false, fallback: true, reason: 'shell_exited_before_sentinel', stdout, stderr });
      };

      const onError = (err) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this.child = null;
        resolve({ ok: false, fallback: true, reason: 'stream_error:' + err.message });
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        timedOut = true;
        cleanup();
        killAndRespawn();
        resolve({ ok: true, stdout, stderr, exitCode: null, timedOut: true, overflowed: false });
      }, timeout);

      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.on('exit', onExit);
      child.on('error', onError);

      // Write the command then echo the sentinel + exit code. The leading
      // newline guards against the previous line being un-terminated.
      try {
        child.stdin.write('\n' + command + '\n');
        child.stdin.write('printf "%s%d__\\n" "' + SENTINEL_PREFIX + this.counter + '__" "$?"\n');
      } catch (err) {
        if (resolved) return;
        resolved = true;
        cleanup();
        this.child = null;
        resolve({ ok: false, fallback: true, reason: 'stdin_write_failed:' + err.message });
      }
    });
  }
}

let shared = null;

function isEnabled() {
  return process.env.BRIDGE_RUNNER_PERSISTENT_SHELL === '1';
}

// Reuse the existing shared shell when the (cwd, env) tuple matches. We
// don't condition on isAlive() here — a fresh PersistentShell with a null
// child is "ready to spawn on demand," not "dead and unusable." If the
// child has actually exited mid-session, run() respawns it transparently.
function getShell(cwd, env) {
  if (!shared || !shared.matches(cwd, env)) {
    if (shared) shared.shutdown();
    shared = new PersistentShell({ cwd, env });
  }
  return shared;
}

function reset() {
  if (shared) shared.shutdown();
  shared = null;
}

module.exports = { PersistentShell, getShell, isEnabled, reset, SENTINEL_PREFIX };
