'use strict';

// A host is a way to run the SAME bridge. It is not a different agent, model,
// or permission level. Keeping this table in one place prevents port drift.
const HOSTS = Object.freeze({
  standalone: Object.freeze({ name: 'Standalone', port: 11467, timeout: 30000 }),
  desktop: Object.freeze({ name: 'Desktop — dedicated editor', port: 11447, timeout: 60000 }),
  browser: Object.freeze({ name: 'Browser — browser editor', port: 11457, timeout: 90000 }),
  vscode: Object.freeze({ name: 'VS Code — existing/debug', port: 11437, timeout: 5000 }),
});

function validateHost(host) {
  if (!Object.hasOwn(HOSTS, host)) throw new Error('Bridge host must be standalone, desktop, browser, or vscode.');
  return host;
}

function validateVscodeUrl(value = 'http://127.0.0.1:11437/v1/messages') {
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

function createHostManager(injected, options = {}) {
  // Constructing/discovering an ACP agent must be passive. Real OS operations
  // are obtained lazily, only when a human actually submits a prompt.
  let operations = injected;
  const vscodeUrl = validateVscodeUrl(options.vscodeUrl);
  return {
    async ensure(host, { signal, onStatus = () => {} } = {}) {
      validateHost(host);
      const target = HOSTS[host];
      const bridgeUrl = host === 'vscode' ? vscodeUrl : `http://127.0.0.1:${target.port}/v1/messages`;
      const timeout = options.timeouts?.[host] ?? target.timeout;
      const expiry = new AbortController();
      const combined = signal ? AbortSignal.any([signal, expiry.signal]) : expiry.signal;
      const timer = setTimeout(
        () =>
          expiry.abort(
            new Error(
              `${target.name} is not ready. ${host === 'browser' ? 'Open http://127.0.0.1:18080/, finish login, and keep the editor tab open; then retry.' : 'Inspect the selected bridge in its editor or private service logs, then retry.'}`,
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
        operations ||= require('./control').connectionOperations();
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

module.exports = { HOSTS, validateHost, validateVscodeUrl, createHostManager };
