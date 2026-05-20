'use strict';

/**
 * model-client.js — Posts requests to the local bridge.
 *
 * Two modes:
 *   post(body, bridgeUrl)       — buffer full response, return parsed JSON
 *   postStream(body, cb, bridgeUrl) — stream SSE events, call cb(event) per frame
 *
 * Endpoint: POST http://127.0.0.1:11437/v1/messages
 * Body: Anthropic Messages API JSON
 */

const http = require('http');

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:11437/v1/messages';

function post(body, bridgeUrl) {
  const url = bridgeUrl || DEFAULT_BRIDGE_URL;
  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const reqUrl = new URL(url);
    const options = {
      hostname: reqUrl.hostname,
      port: reqUrl.port || 80,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyStr),
      },
      timeout: 120000,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error('Bridge returned HTTP ' + res.statusCode + ': ' + raw.slice(0, 500)));
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch {
          reject(new Error('Invalid JSON from bridge: ' + raw.slice(0, 500)));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Request error: ' + err.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 120s'));
    });

    req.write(bodyStr);
    req.end();
  });
}

/**
 * Stream SSE events from the bridge. Each complete SSE frame is parsed as
 * JSON and passed to cb(event). Text content is also forwarded to stdout
 * live when opts.streamOutput is true.
 */
function postStream(body, cb, bridgeUrl, opts) {
  const url = bridgeUrl || DEFAULT_BRIDGE_URL;
  const bodyStr = JSON.stringify(body);
  const options = { streamOutput: false, ...opts };

  return new Promise((resolve, reject) => {
    const reqUrl = new URL(url);
    const reqOpts = {
      hostname: reqUrl.hostname,
      port: reqUrl.port || 80,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyStr),
        accept: 'text/event-stream',
      },
      timeout: 120000,
    };

    const req = http.request(reqOpts, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          reject(new Error('Bridge returned HTTP ' + res.statusCode + ': ' + raw.slice(0, 500)));
        });
        return;
      }

      let buffer = '';
      let fullContent = []; // accumulate for non-streaming fallback
      let lastText = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');

        // Split on double newline (SSE frame boundary)
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // keep incomplete frame in buffer

        for (const frame of parts) {
          const lines = frame.split('\n');
          const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());

          if (dataLines.length === 0) continue;
          const data = dataLines.join('\n');

          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            if (options.streamOutput) {
              // Stream text deltas to stdout
              if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
                process.stdout.write(event.delta.text);
                lastText += event.delta.text;
              }
              // Accumulate for transcript
              if (event.type === 'content_block_start' && event.content_block) {
                fullContent.push(event.content_block);
              }
            }
            if (cb) cb(event);
          } catch {
            // ignore parse errors on partial frames
          }
        }
      });

      res.on('end', () => {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          const dataLines = buffer
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart());
          const data = dataLines.join('\n');
          if (data && data !== '[DONE]') {
            try {
              const event = JSON.parse(data);
              if (cb) cb(event);
            } catch {
              // ignore
            }
          }
        }

        if (options.streamOutput && lastText) {
          process.stdout.write('\n');
        }
        resolve({ streamed: true, content: fullContent });
      });

      res.on('error', (err) => {
        reject(new Error('Stream error: ' + err.message));
      });
    });

    req.on('error', (err) => reject(new Error('Request error: ' + err.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 120s'));
    });

    req.write(bodyStr);
    req.end();
  });
}

module.exports = { post, postStream };
