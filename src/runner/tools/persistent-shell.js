'use strict';

/**
 * persistent-shell.js — Pre-started, single-use bash processes for the runner.
 *
 * Spawning a fresh shell per bash call costs ~30–100ms each on Linux. A
 * coding agent that fires bash dozens of times per session pays that
 * tax over and over. This module pays it BETWEEN commands instead of during
 * them: one bash process is always waiting, already started, and each command
 * is handed that waiting process. A sentinel line marks where its output ends.
 *
 * One process runs exactly ONE command (owner decision, 2026-11-12).
 *   As soon as a command finishes, its process is retired and a replacement is
 *   started in the background. Nothing a command leaves behind — shell
 *   options (`shopt`), the current folder (`cd`), variables, functions — can
 *   reach a later command, because no later command ever runs in that
 *   process. This matters for safety: the shell scanner judges one command's
 *   text at a time and models bash's DEFAULT behavior. When a single process
 *   was reused, `shopt -s dotglob` in one call followed by `cat *rc` in the
 *   next passed the scanner and read a protected dot-file. See
 *   test/runner/persistent-shell-cross-call.test.js.
 *
 *   The file, class, and environment-variable names still say "persistent"
 *   so existing configuration keeps working. What persists is a READY shell,
 *   never a USED one.
 *
 * Status: opt-in. The bash tool only enables this path when the env var
 * BRIDGE_RUNNER_PERSISTENT_SHELL=1 is set. Default behavior (spawnSync
 * per call) is unchanged.
 *
 * Safety notes:
 *   - All shell-policy / permissions checks run upstream of this module
 *     (see tool-registry.js, permissions.js, shell-policy.js). By the
 *     time a command reaches this module it has already been gated and is
 *     approved to execute.
 *   - Per-call timeout and per-call output cap kill the process outright, so
 *     a hung or runaway command cannot starve or OOM the runner.
 *   - Every process is spawned with the same safety.buildSafeEnv() result
 *     that spawnSync uses, so env scrubbing (and the --no-network proxy
 *     settings) apply freshly to every command.
 *   - If the env/cwd a caller passes does not match, the waiting process is
 *     discarded and a new one is started for the new context.
 *   - A waiting process was started in the working folder as it existed at
 *     that moment. That is the same snapshot behavior the reused shell had.
 */

const { spawn } = require('child_process');

const SENTINEL_PREFIX = '__BRIDGE_RUNNER_SH_END__';
const HARD_OUTPUT_CAP = 10 * 1024 * 1024;

function envKey(env) {
  // Cheap fingerprint so we know when to respawn. Stringifying the env
  // every call is fine — it's small and only runs when bash is invoked.
  return JSON.stringify(env);
}

/** True while a bash child exists and has neither exited nor been killed. */
function isLive(child) {
  return !!(child && child.exitCode === null && !child.killed);
}

/**
 * Stop a bash child. Closing stdin lets an idle bash exit cleanly on
 * end-of-input; the signal covers a bash that is busy with something else.
 */
function retire(child, signal) {
  if (!child) return;
  try {
    if (child.stdin && !child.stdin.destroyed) child.stdin.end();
    child.kill(signal);
  } catch {
    // already gone
  }
}

class PersistentShell {
  constructor(opts) {
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.envKey = envKey(opts.env);
    // `child` is the pre-started bash that has NOT run anything yet.
    // `active` is the bash currently running a command (at most one).
    // A process moves child -> active -> retired and never moves back.
    this.child = null;
    this.active = null;
    this.busy = false;
    this.closed = false;
    this.counter = 0;
    this.lastError = null;
  }

  _spawn() {
    // --norc / --noprofile keeps startup deterministic. -i would enable
    // job control noise; we leave it off and rely on the sentinel.
    const child = spawn('/bin/bash', ['--norc', '--noprofile'], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Don't let a waiting shell keep the parent process alive. If
    // the parent exits without an explicit shutdown(), bash inherits the
    // EOF on its stdin and exits on its own.
    child.unref();
    if (child.stdout) child.stdout.unref();
    if (child.stderr) child.stderr.unref();
    if (child.stdin) {
      child.stdin.unref();
      // Closing or writing to the input of a bash that has just exited can
      // raise a stream error. With no listener, Node would crash the runner.
      child.stdin.on('error', () => {});
    }
    // Several processes exist over this object's lifetime, so only clear the
    // waiting slot if THIS process is still the one in it. Otherwise an old,
    // retired process exiting would throw away the new waiting one.
    child.on('error', (err) => {
      this.lastError = err;
      if (this.child === child) this.child = null;
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
    });
    return child;
  }

  /** Start the next bash now so the next command does not wait for it. */
  prewarm() {
    if (this.closed || isLive(this.child)) return;
    try {
      this.child = this._spawn();
    } catch (err) {
      this.lastError = err;
      this.child = null;
    }
  }

  _schedulePrewarm() {
    // Deferred so the finished command's result is returned first. unref():
    // a runner that is about to exit must not be kept alive, or made to start
    // a stray bash, just for this.
    setImmediate(() => this.prewarm()).unref();
  }

  isAlive() {
    return isLive(this.child) || isLive(this.active);
  }

  matches(cwd, env) {
    return this.cwd === cwd && this.envKey === envKey(env);
  }

  shutdown() {
    this.closed = true;
    retire(this.child, 'SIGTERM');
    retire(this.active, 'SIGTERM');
    this.child = null;
    this.active = null;
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
      this.closed = false;
      // Take the pre-started bash out of the waiting slot. From here on it
      // belongs to this one command and is never offered to another.
      let child = this.child;
      this.child = null;
      if (!isLive(child)) {
        try {
          child = this._spawn();
        } catch (err) {
          resolve({ ok: false, fallback: true, reason: 'spawn_failed:' + err.message });
          return;
        }
      }
      if (!isLive(child)) {
        resolve({ ok: false, fallback: true, reason: 'shell_not_alive' });
        return;
      }
      this.busy = true;
      this.active = child;
      this.counter++;

      const sentinel = SENTINEL_PREFIX + this.counter + '__';
      const sentinelRe = new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(-?\\d+)__');

      let stdout = '';
      let stderr = '';
      let resolved = false;

      // Single exit point for every outcome. Whatever happened, this bash has
      // now been used: stop it, and line up an untouched one for the next call.
      // `signal` is SIGTERM after a normal finish (bash is idle and may run its
      // own EXIT cleanup) and SIGKILL when the command had to be cut off.
      const settle = (result, signal) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        child.stdout.removeListener('data', onStdout);
        child.stderr.removeListener('data', onStderr);
        child.removeListener('exit', onExit);
        child.removeListener('error', onError);
        this.busy = false;
        this.active = null;
        retire(child, signal);
        this._schedulePrewarm();
        resolve(result);
      };

      const overflow = (partialStdout, partialStderr) =>
        settle(
          { ok: true, stdout: partialStdout, stderr: partialStderr, exitCode: null, timedOut: false, overflowed: true },
          'SIGKILL',
        );

      const onStdout = (chunk) => {
        if (resolved) return;
        stdout += chunk.toString('utf8');
        if (stdout.length + stderr.length > maxBytes) {
          overflow(stdout.slice(0, maxBytes), stderr);
          return;
        }
        const match = stdout.match(sentinelRe);
        if (match) {
          settle(
            {
              ok: true,
              stdout: stdout.slice(0, match.index),
              stderr,
              exitCode: parseInt(match[1], 10),
              timedOut: false,
              overflowed: false,
            },
            'SIGTERM',
          );
        }
      };

      const onStderr = (chunk) => {
        if (resolved) return;
        stderr += chunk.toString('utf8');
        if (stdout.length + stderr.length > maxBytes) overflow(stdout, stderr.slice(0, maxBytes));
      };

      const onExit = () => {
        settle({ ok: false, fallback: true, reason: 'shell_exited_before_sentinel', stdout, stderr }, 'SIGKILL');
      };

      const onError = (err) => {
        settle({ ok: false, fallback: true, reason: 'stream_error:' + err.message }, 'SIGKILL');
      };

      const timer = setTimeout(() => {
        settle({ ok: true, stdout, stderr, exitCode: null, timedOut: true, overflowed: false }, 'SIGKILL');
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
        settle({ ok: false, fallback: true, reason: 'stdin_write_failed:' + err.message }, 'SIGKILL');
      }
    });
  }
}

let shared = null;

function isEnabled() {
  return process.env.BRIDGE_RUNNER_PERSISTENT_SHELL === '1';
}

// Reuse the existing shared launcher when the (cwd, env) tuple matches. "Reuse"
// means its WAITING bash is used for the next command; a bash that has already
// run a command is never reused. A fresh PersistentShell with nothing waiting
// is "ready to spawn on demand" — run() starts a bash itself in that case.
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
