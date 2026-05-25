'use strict';

/**
 * streaming-write.js — Pipe AsyncIterable<string> content to a file
 * incrementally, avoiding a full in-memory buffer of the model's emitted
 * write_file payload.
 *
 * Today the Anthropic SDK call in model-client returns a parsed `input`
 * object with the full content string already buffered. To actually use
 * this helper end-to-end, model-client.js would need to expose the
 * content_block_delta input_json_delta stream — a follow-up that touches
 * the bridge boundary (out of scope per CLAUDE.md for this PR).
 *
 * Until then this module is exported as standalone infrastructure with
 * its own tests. Reachable from any future tool that returns the deltas
 * directly.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_HARD_CAP = 10 * 1024 * 1024;

/**
 * Stream `chunks` (AsyncIterable<string>) to `targetPath`, computing a sha256
 * on the way and enforcing a byte cap. Returns
 *   { bytes, sha256, truncated, hardCap }.
 *
 * Caller is responsible for permission checks and backup creation BEFORE
 * invoking this; the helper assumes write authorization is already granted.
 */
async function streamToFile(targetPath, chunks, options = {}) {
  const hardCap = options.hardCap || DEFAULT_HARD_CAP;
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = targetPath + '.tmp.' + process.pid + '.' + Date.now();
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let truncated = false;

  const ws = fs.createWriteStream(tmp, { flags: 'w' });

  try {
    for await (const chunk of chunks) {
      if (chunk === null || chunk === undefined) continue;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
      const remaining = hardCap - bytes;
      if (buf.length > remaining) {
        if (remaining > 0) {
          const slice = buf.subarray(0, remaining);
          ws.write(slice);
          hash.update(slice);
          bytes += slice.length;
        }
        truncated = true;
        break;
      }
      ws.write(buf);
      hash.update(buf);
      bytes += buf.length;
    }
    await new Promise((resolve, reject) => {
      ws.end((err) => (err ? reject(err) : resolve()));
    });
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    try {
      ws.destroy();
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }

  return {
    bytes,
    sha256: hash.digest('hex'),
    truncated,
    hardCap,
  };
}

module.exports = {
  streamToFile,
  DEFAULT_HARD_CAP,
};
