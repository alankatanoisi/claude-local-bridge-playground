'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { setTimeout: pause } = require('timers/promises');
const { privateAtomicWriteSync } = require('../runner/private-fs');

const execute = promisify(execFile);

// These operations are deliberately separate from the old, exclusive Start
// command. There is no stop operation here for the ACP caller to invoke.
function connectionOperations({ root, modes, webPort, lockPort = 18081, executeCommand = execute }) {
  const domain = `gui/${process.getuid()}`;
  const label = (mode) => `org.alan.claude-bridge-lab.${mode}`;
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
        await executeCommand('/bin/launchctl', ['print', `${domain}/${label(mode)}`], {
          signal,
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8',
        })
      ).stdout;
    } catch (error) {
      signal?.throwIfAborted();
      // launchctl uses 113 for an absent service on current macOS.
      if (error.code === 113 || error.code === 3) return { loaded: false, pid: null };
      throw new Error('Could not inspect the selected managed bridge job. No service was changed.');
    }
    return { loaded: true, pid: Number(text.match(/\n\s*pid = (\d+)/)?.[1]) || null };
  }
  async function listenerPids(port, signal) {
    return (await command('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], signal, true))
      .split('\n')
      .filter((row) => /^p\d+$/.test(row))
      .map((row) => Number(row.slice(1)));
  }
  async function ownedBy(pids, rootPid, signal) {
    if (!rootPid || !pids.length) return false;
    const rows = (await command('/bin/ps', ['-axo', 'pid=,ppid='], signal))
      .trim()
      .split('\n')
      .map((row) => row.trim().split(/\s+/).map(Number));
    const owned = new Set([rootPid]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [pid, parent] of rows)
        if (owned.has(parent) && !owned.has(pid)) {
          owned.add(pid);
          changed = true;
        }
    }
    return pids.every((pid) => owned.has(pid));
  }
  async function probe(url, signal) {
    try {
      const response = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost' },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(1200)]),
      });
      await response.body?.cancel();
      return response.status === 204;
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }
  async function locked(action, signal) {
    // Use the SAME OS-owned lock as install/start/stop, but wait cooperatively
    // rather than failing simultaneous chats or leaving a stale lock file.
    while (true) {
      signal.throwIfAborted();
      const server = net.createServer((socket) => socket.destroy());
      const acquired = await new Promise((resolve, reject) => {
        server.once('error', (error) =>
          error.code === 'EADDRINUSE'
            ? resolve(false)
            : reject(new Error('Could not acquire the bridge controller lock.')),
        );
        server.listen(lockPort, '127.0.0.1', () => resolve(true));
      });
      if (!acquired) {
        await pause(100, undefined, { signal });
        continue;
      }
      try {
        signal.throwIfAborted();
        return await action();
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }
  return {
    probe,
    locked,
    installed: async (mode) =>
      fs.existsSync(path.join(root, 'installation.json')) && fs.existsSync(path.join(root, 'jobs', mode + '.plist')),
    async inspect(mode, signal) {
      const state = await job(mode, signal);
      const pids = await listenerPids(modes[mode], signal);
      const owned = await ownedBy(pids, state.pid, signal);
      const ready = owned && (await probe(`http://127.0.0.1:${modes[mode]}/v1/messages`, signal));
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
          ? ['kickstart', `${domain}/${label(mode)}`]
          : ['bootstrap', domain, path.join(root, 'jobs', mode + '.plist')],
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
