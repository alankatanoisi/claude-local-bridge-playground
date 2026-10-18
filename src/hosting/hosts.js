'use strict';

/**
 * hosts.js — the ONE table of bridge hosts, plus the small set of primitives
 * every caller uses to talk to them.
 *
 * A "host" is a way to run the SAME bridge: the VS Code extension (or the
 * standalone server) that holds Claude Code's credentials and answers
 * /v1/messages on a loopback port. A host is not a different agent, model, or
 * permission level.
 *
 * Two callers share this file and must never drift apart:
 *
 *   - control.js — the Finder-launcher controller (install / start / stop /
 *     status / test). Synchronous subprocess calls; its Start verb is
 *     exclusive (it stops the other managed hosts first).
 *   - connection-operations.js — the ACP (Agent Client Protocol) adapter that
 *     connects one chat to one host. Abortable subprocess calls; it never
 *     stops anything.
 *
 * Until 2026-10-17 each caller carried its own copy of the ports, the launchd
 * label, the process-inspection parsers, the readiness probe, and the
 * controller lock — and the copies had already started to disagree (Cursor
 * thermo-nuclear review, High #1). Everything they share now lives here, and
 * only here. If you need a port, a launchd name, or a parser, import it; do
 * not retype it.
 */

const net = require('net');
const os = require('os');
const path = require('path');
const { setTimeout: pause } = require('timers/promises');
// The ordinary VS Code bridge address is owned by the runner's model client;
// the "vscode" host below derives its port from it rather than repeating 11437.
const { DEFAULT_BRIDGE_URL } = require('../runner/model-client');

// ── Ports, names, and places ───────────────────────────────────────────────

/** The browser editor (code-server) HTTP port. Its bridge is HOSTS.browser.port. */
const WEB_PORT = 18080;
/** Loopback port that serves as the controller lock (see withLoopbackLock). */
const LOCK_PORT = 18081;
/** launchd label prefix of the three jobs the installer creates. */
const LABEL_PREFIX = 'org.alan.claude-bridge-lab.';
/** Where the installer keeps the managed hosts' jobs, logs, and private state. */
const ROOT = path.join(os.homedir(), 'Library', 'Application Support', 'Claude Bridge Lab');

/** The Messages endpoint a bridge serves on `port`. */
const messagesUrl = (port) => `http://127.0.0.1:${port}/v1/messages`;
/** The browser editor's front page (login + the tab that keeps its bridge alive). */
const BROWSER_EDITOR_URL = `http://127.0.0.1:${WEB_PORT}/`;

/**
 * The host table. Key order is the order the ACP composer shows the choices
 * (standalone first because it is the new-chat default); a protocol test pins
 * that order. `managed` marks the three hosts launchd runs for us; `vscode` is
 * Alan's ordinary editor and is connect-only everywhere in this repo.
 * `description` is the one-line blurb the composer shows under each choice.
 */
const HOSTS = Object.freeze({
  standalone: Object.freeze({
    name: 'Standalone',
    port: 11467,
    timeout: 30000,
    managed: true,
    description: 'No editor window required.',
  }),
  desktop: Object.freeze({
    name: 'Desktop — dedicated editor',
    port: 11447,
    timeout: 60000,
    managed: true,
    description: 'Starts the dedicated desktop editor, leaving other hosts running.',
  }),
  browser: Object.freeze({
    name: 'Browser — browser editor',
    port: 11457,
    timeout: 90000,
    managed: true,
    description: 'Opens the local browser editor if needed; keep its tab open.',
  }),
  vscode: Object.freeze({
    name: 'VS Code — existing/debug',
    port: Number(new URL(DEFAULT_BRIDGE_URL).port),
    timeout: 5000,
    managed: false,
    description: 'Use your existing VS Code bridge for debugging; start it yourself.',
  }),
});

/**
 * mode → port for the launchd-managed hosts only. Derived from HOSTS so the
 * two can never disagree; the controller iterates this for status/stop/install.
 */
const MODES = Object.freeze(
  Object.fromEntries(
    Object.entries(HOSTS)
      .filter(([, host]) => host.managed)
      .map(([mode, host]) => [mode, host.port]),
  ),
);

function validateHost(host) {
  if (!Object.hasOwn(HOSTS, host)) throw new Error('Bridge host must be standalone, desktop, browser, or vscode.');
  return host;
}

// ── launchd naming ─────────────────────────────────────────────────────────
// launchd addresses a user job as "gui/<uid>/<label>". Both callers build
// that string here so a renamed label cannot strand one of them.

const launchdDomain = () => `gui/${process.getuid()}`;
const launchdLabel = (mode) => LABEL_PREFIX + mode;
const launchdTarget = (mode) => `${launchdDomain()}/${launchdLabel(mode)}`;

// ── Reading the three macOS tools ──────────────────────────────────────────
// The subprocess calls differ by caller (sync vs. abortable), but how their
// output is understood is one rule.

/**
 * `launchctl print` exit codes that mean "no such service" (113 on current
 * macOS — verified on 27.2, 2026-10-17 — and 3 on older releases). Any other
 * failure is unknown state, which callers report instead of guessing.
 */
const ABSENT_JOB_EXIT_CODES = Object.freeze([113, 3]);
/** The fixed message callers raise on an unknown inspection failure (never captured subprocess output). */
const INSPECT_FAILURE_MESSAGE = 'Could not inspect the selected managed bridge job. No service was changed.';

/** Decode `launchctl print` output for a loaded job: its pid, or null when loaded but not running. */
function jobStateFromPrint(text) {
  return { loaded: true, pid: Number(String(text).match(/\n\s*pid = (\d+)/)?.[1]) || null };
}

/** Decode a failed `launchctl print`: the not-loaded state for an absent job, or null for an unknown failure. */
function jobStateFromExitCode(code) {
  return ABSENT_JOB_EXIT_CODES.includes(code) ? { loaded: false, pid: null } : null;
}

/** Pids from `lsof -Fp` output (one "p<pid>" row per listening process). */
function listenerPidsFrom(text) {
  return String(text)
    .split('\n')
    .filter((row) => /^p\d+$/.test(row))
    .map((row) => Number(row.slice(1)));
}

/** Numeric rows from `ps -axo pid=,ppid=[,...]` output. */
function processRowsFrom(text) {
  return String(text)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((row) => row.trim().split(/\s+/).map(Number));
}

/** The set of `rootPid` and every process descended from it, walked over `rows` ([pid, ppid, ...]). */
function descendantPids(rows, rootPid) {
  const owned = new Set([rootPid]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [pid, parent] of rows)
      if (owned.has(parent) && !owned.has(pid)) {
        owned.add(pid);
        changed = true;
      }
  }
  return owned;
}

/**
 * True only when there is at least one listener AND every listener belongs to
 * the managed job's process tree. A listener outside that tree is never
 * adopted, whatever port it sits on.
 */
function ownsAllListeners(listenerPids, rootPid, rows) {
  if (!rootPid || !listenerPids.length) return false;
  const owned = descendantPids(rows, rootPid);
  return listenerPids.every((pid) => owned.has(pid));
}

// ── Readiness probe ────────────────────────────────────────────────────────

/**
 * Is a bridge answering at `url`? An OPTIONS request is a CORS preflight: the
 * bridge replies 204 when its server is up, without a model call and without
 * credentials. A redirect, a non-204, a timeout, or a refused connection all
 * read as "not ready"; only an external abort propagates.
 */
async function probeMessagesEndpoint(url, { signal, timeoutMs = 1500 } = {}) {
  const expiry = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, expiry]) : expiry,
    });
    await response.body?.cancel();
    return response.status === 204;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

// ── Controller lock ────────────────────────────────────────────────────────

/**
 * Run `action` while holding the loopback lock on `port`. The operating
 * system owns the lock: a listening socket disappears when its holder exits
 * or crashes, so there is no stale lock file to clean up.
 *
 * Two modes share one body:
 *   wait: false — the controller. A busy lock rejects at once.
 *   wait: true  — the ACP adapter. A busy lock is polled every 100 ms until it
 *                 frees or `signal` aborts (a Stop in the chat).
 */
async function withLoopbackLock(action, { port = LOCK_PORT, wait = false, signal } = {}) {
  while (true) {
    signal?.throwIfAborted();
    const lock = net.createServer((socket) => socket.destroy());
    const acquired = await new Promise((resolve, reject) => {
      lock.once('error', (error) =>
        error.code === 'EADDRINUSE'
          ? resolve(false)
          : reject(new Error(`Could not acquire the bridge controller lock on port ${port}.`)),
      );
      lock.listen(port, '127.0.0.1', () => resolve(true));
    });
    if (!acquired) {
      if (!wait) throw new Error(`Another bridge control operation is active, or control port ${port} is occupied.`);
      await pause(100, undefined, { signal });
      continue;
    }
    try {
      signal?.throwIfAborted();
      return await action();
    } finally {
      await new Promise((resolve) => lock.close(resolve));
    }
  }
}

module.exports = {
  HOSTS,
  MODES,
  WEB_PORT,
  LOCK_PORT,
  LABEL_PREFIX,
  ROOT,
  BROWSER_EDITOR_URL,
  messagesUrl,
  validateHost,
  launchdDomain,
  launchdLabel,
  launchdTarget,
  ABSENT_JOB_EXIT_CODES,
  INSPECT_FAILURE_MESSAGE,
  jobStateFromPrint,
  jobStateFromExitCode,
  listenerPidsFrom,
  processRowsFrom,
  descendantPids,
  ownsAllListeners,
  probeMessagesEndpoint,
  withLoopbackLock,
};
