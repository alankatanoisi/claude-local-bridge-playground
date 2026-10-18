'use strict';

// connection-operations.js — the ACP (Agent Client Protocol) adapter that
// connects one chat to one managed bridge host. Every call here is abortable
// (a Stop in the chat cancels it) and NOTHING here stops a service: there is
// deliberately no stop operation for the ACP caller to invoke, and startup
// uses bootstrap-or-kickstart, never the controller's exclusive Start verb.
//
// Ports, launchd names, output parsers, the readiness probe, and the
// controller lock come from hosts.js — the same code the Finder controller
// (control.js) runs — so the two cannot disagree about what a job, a listener,
// or a busy lock looks like.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { setTimeout: pause } = require('timers/promises');
const { privateAtomicWriteSync } = require('../runner/private-fs');
const {
  MODES,
  WEB_PORT,
  LOCK_PORT,
  ROOT,
  INSPECT_FAILURE_MESSAGE,
  messagesUrl,
  launchdDomain,
  launchdTarget,
  jobStateFromPrint,
  jobStateFromExitCode,
  listenerPidsFrom,
  processRowsFrom,
  ownsAllListeners,
  probeMessagesEndpoint,
  withLoopbackLock,
} = require('./hosts');

const execute = promisify(execFile);

/**
 * Build the adapter. Construction is passive (closures only, no subprocess),
 * so the ACP entry point can create it at startup and discovery stays free of
 * process launches. The defaults are the real installation; tests override
 * `root`, the ports, and `executeCommand` to stay off the real machine.
 */
function connectionOperations({
  root = ROOT,
  modes = MODES,
  webPort = WEB_PORT,
  lockPort = LOCK_PORT,
  executeCommand = execute,
} = {}) {
  async function command(program, args, signal, allowExitOne = false) {
    try {
      return (await executeCommand(program, args, { signal, timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' }))
        .stdout;
    } catch (error) {
      signal?.throwIfAborted();
      if (allowExitOne && error.code === 1) return '';
      // Captured process output is private and must not become a T3 card.
      throw new Error('A local bridge control command failed. Inspect the dedicated private service logs.');
    }
  }
  async function job(mode, signal) {
    let text;
    try {
      text = (
        await executeCommand('/bin/launchctl', ['print', launchdTarget(mode)], {
          signal,
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8',
        })
      ).stdout;
    } catch (error) {
      signal?.throwIfAborted();
      // The promisified execFile reports the child's exit code as `code`.
      const absent = jobStateFromExitCode(error.code);
      if (absent) return absent;
      throw new Error(INSPECT_FAILURE_MESSAGE);
    }
    return jobStateFromPrint(text);
  }
  async function listenerPids(port, signal) {
    // lsof exits 1 when nothing listens on the port; that is an empty answer.
    return listenerPidsFrom(
      await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], signal, true),
    );
  }
  async function ownedBy(pids, rootPid, signal) {
    if (!rootPid || !pids.length) return false;
    return ownsAllListeners(pids, rootPid, processRowsFrom(await command('/bin/ps', ['-axo', 'pid=,ppid='], signal)));
  }
  const probe = (url, signal) => probeMessagesEndpoint(url, { signal });
  // Same OS-owned lock as install/start/stop, but a chat waits its turn
  // cooperatively instead of failing when another chat is mid-connection.
  const locked = (action, signal) => withLoopbackLock(action, { port: lockPort, wait: true, signal });
  return {
    probe,
    locked,
    installed: async (mode) =>
      fs.existsSync(path.join(root, 'installation.json')) && fs.existsSync(path.join(root, 'jobs', mode + '.plist')),
    async inspect(mode, signal) {
      const state = await job(mode, signal);
      const pids = await listenerPids(modes[mode], signal);
      const owned = await ownedBy(pids, state.pid, signal);
      const ready = owned && (await probe(messagesUrl(modes[mode]), signal));
      let editorReady = false;
      if (mode === 'browser' && state.pid && !ready) {
        const editorPids = await listenerPids(webPort, signal);
        editorReady = await ownedBy(editorPids, state.pid, signal);
      }
      return { ...state, occupied: pids.length > 0, owned, ready, editorReady };
    },
    async start(mode, signal, { loaded = false } = {}) {
      if (process.platform !== 'darwin')
        throw new Error('Managed bridge startup requires macOS. Existing/debug connections can still be used.');
      // Confirm both ports are free immediately before launch. A race after
      // this check is still caught by strict-port startup and ownership checks.
      const ports = mode === 'browser' ? [modes[mode], webPort] : [modes[mode]];
      for (const port of ports)
        if ((await listenerPids(port, signal)).length)
          throw new Error(`Port ${port} is occupied by another process. No process was stopped.`);
      // Closing the desktop editor can leave its job loaded with no PID.
      // kickstart WITHOUT -k starts that stopped job; it never kills a process.
      await command(
        '/bin/launchctl',
        loaded
          ? ['kickstart', launchdTarget(mode)]
          : ['bootstrap', launchdDomain(), path.join(root, 'jobs', mode + '.plist')],
        signal,
      );
    },
    async openBrowser(pid, signal) {
      if (!pid) return;
      await locked(async () => {
        const current = await job('browser', signal);
        if (current.pid !== pid) return;
        const record = path.join(root, 'browser-open-attempt.json');
        let previous;
        try {
          previous = JSON.parse(fs.readFileSync(record, 'utf8'));
        } catch (error) {
          if (error.code !== 'ENOENT')
            throw new Error('Could not read browser activation state. Inspect the private service state.');
        }
        // One tab per activation window across ALL ACP processes. A later
        // prompt can reopen a closed editor after the 90-second window ends.
        if (previous?.pid === pid && Date.now() - previous.openedAt < 90000) return;
        signal.throwIfAborted();
        await command('/usr/bin/open', [`http://127.0.0.1:${webPort}/`], signal);
        privateAtomicWriteSync(record, JSON.stringify({ pid, openedAt: Date.now() }));
      }, signal);
    },
    pause: (signal) => pause(250, undefined, { signal }),
  };
}

module.exports = { connectionOperations };
