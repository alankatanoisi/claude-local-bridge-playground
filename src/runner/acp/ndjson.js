'use strict';

/**
 * ndjson.js — newline-delimited JSON framing for the ACP (Agent Client
 * Protocol) stdio transport.
 *
 * ACP sends one JSON-RPC 2.0 message per line, separated by "\n". This is the
 * sibling of src/runner/lsp/jsonrpc.js, which does the same job for the
 * Content-Length framing that LSP (Language Server Protocol) uses. Only the
 * framing differs; the JSON-RPC envelope on each message is identical.
 *
 * No dependencies, by design — the repo has zero runtime dependencies.
 */

/** Serialize one message into a wire frame (a single line ending in \n). */
function encodeLine(payload) {
  return JSON.stringify(payload) + '\n';
}

/**
 * Incremental line splitter. Feed it raw chunks from a stream; it calls
 * onMessage(parsedObject) once per complete line. A chunk boundary can land
 * anywhere — mid-line, mid-UTF-8-character — so we buffer bytes until a full
 * line exists rather than assuming one chunk equals one message.
 */
function createLineFramer(onMessage) {
  let buffer = Buffer.alloc(0);

  function feed(chunk) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
    while (true) {
      const newlineAt = buffer.indexOf(0x0a); // "\n"
      if (newlineAt === -1) return;
      const line = buffer.slice(0, newlineAt).toString('utf8').trim();
      buffer = buffer.slice(newlineAt + 1);
      if (!line) continue; // tolerate blank lines between messages
      try {
        onMessage(JSON.parse(line));
      } catch {
        // A malformed line cannot be answered (we cannot know its id), so the
        // safe behavior is to drop it and keep the connection alive.
      }
    }
  }

  return { feed };
}

module.exports = {
  encodeLine,
  createLineFramer,
};
