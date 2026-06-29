'use strict';

/**
 * jsonrpc.js — Minimal JSON-RPC 2.0 helpers for LSP stdio transport.
 */

function encodeMessage(payload) {
  const body = JSON.stringify(payload);
  return 'Content-Length: ' + Buffer.byteLength(body, 'utf8') + '\r\n\r\n' + body;
}

function createFramer(onMessage) {
  let buffer = Buffer.alloc(0);

  function feed(chunk) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = parseInt(match[1], 10);
      const start = headerEnd + 4;
      if (buffer.length < start + length) return;
      const body = buffer.slice(start, start + length).toString('utf8');
      buffer = buffer.slice(start + length);
      try {
        onMessage(JSON.parse(body));
      } catch {
        // ignore malformed frames
      }
    }
  }

  return { feed };
}

module.exports = {
  encodeMessage,
  createFramer,
};
