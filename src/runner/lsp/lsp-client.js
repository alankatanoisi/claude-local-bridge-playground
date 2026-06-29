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
    this.child.on('exit', () => {
      this.disposed = true;
      for (const [, pending] of this.pending) {
        pending.reject(new Error('Language server exited unexpectedly.'));
      }
      this.pending.clear();
    });
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
      this._send({ jsonrpc: '2.0', id, method, params });
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
