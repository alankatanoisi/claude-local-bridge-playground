'use strict';

/**
 * connection.js — a small bidirectional JSON-RPC 2.0 endpoint over streams,
 * used by the ACP (Agent Client Protocol) agent.
 *
 * JSON-RPC in one paragraph: every message is a JSON object. A *request* has
 * an `id` and a `method`; whoever receives it must eventually send back a
 * *response* with the same `id`, carrying either `result` or `error`. A
 * *notification* has a `method` but no `id`; it is fire-and-forget and never
 * answered. Both sides of an ACP connection can send requests — the client
 * (T3) calls us with `session/prompt`, and mid-turn we call the client back
 * with `session/request_permission` and wait for its answer.
 *
 * This module owns only that envelope bookkeeping. It knows nothing about the
 * ACP methods themselves — that lives in agent.js.
 */

const { encodeLine, createLineFramer } = require('./ndjson');

// Standard JSON-RPC 2.0 error codes (from the spec).
const ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

/** An error a method handler can throw to control the JSON-RPC error code. */
class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/**
 * @param {object} deps
 * @param {import('stream').Readable} deps.input — incoming frames (our stdin)
 * @param {(line: string) => void} deps.write — outgoing frame writer. The
 *   caller supplies this so the entry point can hand us the *real* stdout
 *   writer while stray writes from the rest of the process are redirected
 *   (see bin/local-bridge-acp.js).
 * @param {(err: Error) => void} [deps.onTransportError] — surfaced instead of thrown
 */
function createConnection({ input, write, onTransportError }) {
  const handlers = new Map(); // method name → async handler(params)
  const pending = new Map(); // outgoing request id → { resolve, reject }
  let nextId = 1;
  let closed = false;

  function send(payload) {
    if (closed) return;
    try {
      write(encodeLine(payload));
    } catch (err) {
      if (onTransportError) onTransportError(err);
    }
  }

  function respondError(id, err) {
    const code = typeof err?.code === 'number' ? err.code : ERROR_CODES.INTERNAL_ERROR;
    send({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message: err && err.message ? String(err.message) : 'Internal error',
        ...(err && err.data !== undefined ? { data: err.data } : {}),
      },
    });
  }

  function dispatch(message) {
    if (!message || typeof message !== 'object') return;

    // A `method` means the peer is calling us (request or notification).
    if (typeof message.method === 'string') {
      const hasId = message.id !== undefined && message.id !== null;
      const handler = handlers.get(message.method);
      if (!handler) {
        // Unknown notifications are silently ignored (the spec's behavior);
        // unknown requests must be answered so the caller does not hang.
        if (hasId)
          respondError(message.id, new RpcError(ERROR_CODES.METHOD_NOT_FOUND, 'Method not found: ' + message.method));
        return;
      }
      Promise.resolve()
        .then(() => handler(message.params))
        .then((result) => {
          if (hasId) send({ jsonrpc: '2.0', id: message.id, result: result === undefined ? {} : result });
        })
        .catch((err) => {
          if (hasId) respondError(message.id, err);
          // A throwing notification handler has no one to report to; the
          // connection must survive it.
        });
      return;
    }

    // No `method` — this is the peer answering one of OUR requests.
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new RpcError(message.error.code, message.error.message, message.error.data));
      } else {
        resolve(message.result);
      }
    }
    // A response to an id we do not know is dropped: nothing waits on it.
  }

  const framer = createLineFramer(dispatch);
  input.on('data', (chunk) => framer.feed(chunk));
  input.on('end', close);
  input.on('close', close);

  function close() {
    if (closed) return;
    closed = true;
    // Anyone still awaiting an answer must learn the peer is gone — a hung
    // promise here would freeze a run mid-approval forever.
    for (const { reject } of pending.values()) {
      reject(new RpcError(ERROR_CODES.INTERNAL_ERROR, 'Connection closed'));
    }
    pending.clear();
  }

  return {
    /** Register the handler for an incoming method (request or notification). */
    onMethod(method, handler) {
      handlers.set(method, handler);
    },
    /** Call the peer and await its response. */
    request(method, params) {
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new RpcError(ERROR_CODES.INTERNAL_ERROR, 'Connection closed'));
          return;
        }
        const id = nextId++;
        pending.set(id, { resolve, reject });
        send({ jsonrpc: '2.0', id, method, params });
      });
    },
    /** Fire-and-forget message to the peer. */
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },
    close,
    get closed() {
      return closed;
    },
  };
}

module.exports = {
  createConnection,
  RpcError,
  ERROR_CODES,
};
