'use strict';

/**
 * lsp-client.js — JSON-RPC client over an LSP stdio process.
 */

const { spawn } = require('child_process');
const { encodeMessage, createFramer } = require('./jsonrpc');

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

class LspClient {
  constructor(options = {}) {
    this.command = options.command;
    this.args = options.args || ['--stdio'];
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.child = options.child || null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
    this.disposed = false;
    // A missing executable is reported asynchronously by Node's ChildProcess.
    // Remember that startup failure so later calls get the same useful error
    // instead of the vague "not running" message.
    this.startupError = null;
    this.framer = createFramer((msg) => this._onMessage(msg));
    if (this.child) {
      this.child.stdout.on('data', (chunk) => this.framer.feed(chunk));
    } else if (this.command) {
      this._spawn();
    }
  }

  _spawn() {
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.framer.feed(chunk));
    this.child.stderr.on('data', () => {
      // language servers are noisy on stderr; ignore for v1
    });
    this.child.on('error', (err) => {
      // `spawn()` does not throw when a command is missing. It emits `error`
      // on the child a moment later. Without this listener, Node treats ENOENT
      // as an uncaught event and terminates the whole runner process.
      const detail =
        err && err.code === 'ENOENT'
          ? 'executable was not found on PATH'
          : err && err.message
            ? err.message
            : 'unknown startup error';
      this.startupError = new Error('Could not start language server "' + this.command + '": ' + detail + '.');
      this._failPending(this.startupError);
    });
    this.child.stdin.on('error', (err) => {
      // A server can also close its input stream during startup. The request
      // waiting for that server should fail cleanly rather than emit EPIPE as
      // another uncaught stream error.
      this._failPending(new Error('Language server input closed: ' + err.message));
    });
    this.child.on('exit', () => {
      this.disposed = true;
      this._failPending(this.startupError || new Error('Language server exited unexpectedly.'));
    });
  }

  _failPending(err) {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  _onMessage(msg) {
    if (msg.id !== null && msg.id !== undefined && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message || 'LSP error'));
      else pending.resolve(msg.result);
      return;
    }
    // diagnostics and other notifications are ignored in v1 unless needed later
  }

  _send(payload) {
    if (this.startupError) {
      throw this.startupError;
    }
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('Language server is not running.');
    }
    this.child.stdin.write(encodeMessage(payload));
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('LSP request timed out: ' + method));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      try {
        this._send({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        // `_send` can fail synchronously after we registered the request.
        // Route it through the normal pending rejection so its timeout is
        // cleared and the map does not retain a dead request.
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (pending) pending.reject(err);
      }
    });
  }

  notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  async initialize(rootUri) {
    if (this.ready) return;
    const result = await this.request('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {},
    });
    this.notify('initialized', {});
    this.ready = true;
    return result;
  }

  openDocument(uri, languageId, text, version = 1) {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.ready) this.notify('exit', null);
    } catch {
      // best-effort
    }
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }
}

module.exports = {
  LspClient,
  DEFAULT_REQUEST_TIMEOUT_MS,
};
