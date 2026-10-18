'use strict';

// ensure.js — host POLICY for one ACP (Agent Client Protocol) chat turn: which
// endpoint a host means, how long to wait for it, that VS Code is connect-only,
// and that a managed host is started but never restarted or stopped. The
// table of hosts lives in hosts.js; the macOS operations are injected (see
// connection-operations.js), so this file performs no process launches itself.

const { HOSTS, BROWSER_EDITOR_URL, messagesUrl, validateHost } = require('./hosts');
const { DEFAULT_BRIDGE_URL } = require('../runner/model-client');

function validateVscodeUrl(value = DEFAULT_BRIDGE_URL) {
  // Do not include a rejected URL in an error: it might contain a password.
  const invalid = () =>
    new Error(
      'BRIDGE_RUNNER_VSCODE_URL must be a loopback HTTP(S) Messages endpoint without credentials, query, or fragment.',
    );
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/v1/messages', '/v1/messages/'].includes(url.pathname)
  )
    throw invalid();
  url.pathname = '/v1/messages';
  return url.href;
}

/**
 * @param {object} operations — the host operations (probe, locked, installed,
 *   inspect, start, openBrowser, pause). The ACP entry point injects the real
 *   macOS adapter; tests inject a fake. Nothing is looked up lazily, so this
 *   module never reaches for control.js and discovery stays passive: the
 *   operations are only CALLED from ensure(), which runs on a prompt.
 */
function createHostManager(operations, options = {}) {
  if (!operations || typeof operations !== 'object')
    throw new Error('createHostManager requires host operations (see src/hosting/connection-operations.js).');
  const vscodeUrl = validateVscodeUrl(options.vscodeUrl);
  return {
    async ensure(host, { signal, onStatus = () => {} } = {}) {
      validateHost(host);
      const target = HOSTS[host];
      const bridgeUrl = host === 'vscode' ? vscodeUrl : messagesUrl(target.port);
      const timeout = options.timeouts?.[host] ?? target.timeout;
      const expiry = new AbortController();
      const combined = signal ? AbortSignal.any([signal, expiry.signal]) : expiry.signal;
      const timer = setTimeout(
        () =>
          expiry.abort(
            new Error(
              `${target.name} is not ready. ${host === 'browser' ? `Open ${BROWSER_EDITOR_URL}, finish login, and keep the editor tab open; then retry.` : 'Inspect the selected bridge in its editor or private service logs, then retry.'}`,
            ),
          ),
        timeout,
      );
      let lastStatus;
      const status = (text) => {
        if (text !== lastStatus) {
          lastStatus = text;
          onStatus(text);
        }
      };
      try {
        combined.throwIfAborted();
        status(`Checking ${target.name}`);
        if (host === 'vscode') {
          // The ordinary editor belongs to Alan. This branch has no start,
          // stop, installation, browser, or ownership-adoption operation.
          if (!(await operations.probe(bridgeUrl, combined))) {
            combined.throwIfAborted();
            throw new Error(
              `The existing VS Code bridge is unavailable at port ${new URL(bridgeUrl).port || (bridgeUrl.startsWith('https:') ? '443' : '80')}. Start the bridge in your VS Code session, then retry.`,
            );
          }
        } else {
          await operations.locked(async () => {
            combined.throwIfAborted();
            const current = await operations.inspect(host, combined);
            if (current.occupied && !current.owned)
              throw new Error(
                `${target.name} port ${target.port} is occupied by another process. No process was stopped.`,
              );
            if (current.pid) return; // wait; never restart a live unhealthy job
            if (!(await operations.installed(host)))
              throw new Error(
                'Install the dedicated bridge hosts using scripts/hosting/Install.command, then retry. No installation was changed.',
              );
            combined.throwIfAborted();
            status(`Starting ${target.name}`);
            await operations.start(host, combined, { loaded: current.loaded });
          }, combined);
          while (true) {
            combined.throwIfAborted();
            const current = await operations.inspect(host, combined);
            if (current.occupied && !current.owned)
              throw new Error(
                `${target.name} port ${target.port} is occupied by another process. No process was stopped.`,
              );
            if (current.ready && current.owned) break;
            if (host === 'browser' && current.editorReady) {
              status('Waiting for browser editor activation; finish login if requested and keep the tab open');
              // The adapter deduplicates open requests across ACP processes.
              await operations.openBrowser(current.pid, combined);
            } else status(`Waiting for ${target.name} activation`);
            await operations.pause(combined);
          }
        }
        combined.throwIfAborted();
        status('Connected—sending prompt');
        return { bridgeUrl };
      } catch (error) {
        // Abort must win a race with a failed network or subprocess operation.
        if (signal?.aborted) throw signal.reason;
        if (expiry.signal.aborted) throw expiry.signal.reason;
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { validateVscodeUrl, createHostManager };
