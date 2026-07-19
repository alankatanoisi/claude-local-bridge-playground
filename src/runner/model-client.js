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
 *
 * Errors are typed so the agent loop can fail-fast on deterministic 4xx
 * responses and only retry transient 429 / 5xx / network failures.
 */

const http = require('http');
const safety = require('./safety');

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:11437/v1/messages';

// Shared keep-alive agent so repeated requests to localhost reuse the same
// TCP connection instead of paying a handshake penalty on every turn.
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });

class BridgeHttpError extends Error {
  constructor(statusCode, body, headers = {}) {
    const snippet = typeof body === 'string' ? body.slice(0, 500) : '';
    super('Bridge returned HTTP ' + statusCode + ': ' + snippet);
    this.name = 'BridgeHttpError';
    this.statusCode = statusCode;
    this.body = body;
    this.headers = headers || {};
    // Deterministic client errors (incl. 401) must not consume retry budget.
    // 429 and 5xx are transient and may retry with backoff / Retry-After.
    this.retryable = statusCode === 429 || statusCode >= 500;
  }
}

class BridgeNetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BridgeNetworkError';
    this.retryable = true;
  }
}

function responseMeta(res) {
  return {
    status_code: res.statusCode,
    headers: {
      'content-type': res.headers['content-type'] || null,
      'x-request-id': res.headers['x-request-id'] || null,
      'retry-after': res.headers['retry-after'] || null,
      'anthropic-ratelimit-requests-remaining': res.headers['anthropic-ratelimit-requests-remaining'] || null,
      'anthropic-ratelimit-tokens-remaining': res.headers['anthropic-ratelimit-tokens-remaining'] || null,
    },
  };
}

function withCallerAuth(headers = {}, callerToken) {
  if (!callerToken) return headers;
  return { authorization: 'Bearer ' + callerToken, ...headers };
}

/**
 * Parse Retry-After as seconds. Supports integer seconds and HTTP-date.
 * Returns null when absent or unusable.
 */
function parseRetryAfterSeconds(headers) {
  const raw = headers && (headers['retry-after'] || headers['Retry-After']);
  if (raw === null || raw === undefined || raw === '') return null;
  const asInt = Number.parseInt(String(raw), 10);
  if (Number.isFinite(asInt) && String(asInt) === String(raw).trim()) {
    return Math.max(0, asInt);
  }
  const when = Date.parse(String(raw));
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  return null;
}

function post(body, bridgeUrl, opts = {}) {
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
        ...withCallerAuth(opts.headers, opts.callerToken),
      },
      timeout: 120000,
      agent: keepAliveAgent,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new BridgeHttpError(res.statusCode, raw, res.headers));
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          parsed._localBridge = responseMeta(res);
          resolve(parsed);
        } catch {
          reject(new Error('Invalid JSON from bridge: ' + raw.slice(0, 500)));
        }
      });
    });

    req.on('error', (err) => reject(new BridgeNetworkError('Request error: ' + err.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new BridgeNetworkError('Request timed out after 120s'));
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
        ...withCallerAuth(options.headers, options.callerToken),
      },
      timeout: 120000,
      agent: keepAliveAgent,
    };

    const req = http.request(reqOpts, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          reject(new BridgeHttpError(res.statusCode, raw, res.headers));
        });
        return;
      }

      let buffer = '';
      const fullContent = [];
      const toolInputBuffers = new Map();
      let lastText = '';
      let messageMeta = {};
      let usage = {};
      // P0-11: scrub live stdout only; assembled content stays raw for tool execution.
      const streamScrubber = options.streamOutput ? safety.makeStreamingScrubber() : null;

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
            if (event.type === 'message_start' && event.message) {
              messageMeta = {
                id: event.message.id,
                role: event.message.role,
                type: event.message.type,
              };
              usage = { ...usage, ...(event.message.usage || {}) };
            }
            if (event.type === 'message_delta' && event.usage) {
              usage = { ...usage, ...event.usage };
            }
            if (event.type === 'content_block_start' && typeof event.index === 'number' && event.content_block) {
              fullContent[event.index] = event.content_block;
              if (event.content_block.type === 'tool_use') {
                toolInputBuffers.set(event.index, '');
              }
            }

            if (event.type === 'content_block_delta' && typeof event.index === 'number' && event.delta) {
              const block = fullContent[event.index];
              if (event.delta.type === 'text_delta') {
                if (!block) fullContent[event.index] = { type: 'text', text: '' };
                fullContent[event.index].text = (fullContent[event.index].text || '') + event.delta.text;
                // Stream scrubbed text deltas to stdout (secrets may split across chunks).
                if (streamScrubber) {
                  const safe = streamScrubber.push(event.delta.text);
                  if (safe) process.stdout.write(safe);
                  lastText += event.delta.text;
                }
              } else if (event.delta.type === 'thinking_delta') {
                if (!block) fullContent[event.index] = { type: 'thinking', thinking: '', signature: '' };
                fullContent[event.index].thinking =
                  (fullContent[event.index].thinking || '') + (event.delta.thinking || '');
              } else if (event.delta.type === 'signature_delta') {
                // Fable/Mythos/Opus adaptive thinking: signature is required for multi-turn tool loops.
                if (!block) fullContent[event.index] = { type: 'thinking', thinking: '', signature: '' };
                fullContent[event.index].signature =
                  (fullContent[event.index].signature || '') + (event.delta.signature || '');
              } else if (event.delta.type === 'input_json_delta') {
                const previous = toolInputBuffers.get(event.index) || '';
                toolInputBuffers.set(event.index, previous + event.delta.partial_json);
              }
            }

            if (event.type === 'content_block_stop' && typeof event.index === 'number') {
              const block = fullContent[event.index];
              if (block && block.type === 'tool_use') {
                const rawInput = toolInputBuffers.get(event.index) || '';
                if (rawInput) {
                  try {
                    block.input = JSON.parse(rawInput);
                  } catch {
                    block.input = {};
                  }
                }
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

        if (streamScrubber) {
          const tail = streamScrubber.end();
          if (tail) process.stdout.write(tail);
          if (lastText) process.stdout.write('\n');
        }
        resolve({
          streamed: true,
          ...messageMeta,
          content: fullContent.filter(Boolean),
          usage,
          _localBridge: responseMeta(res),
        });
      });

      res.on('error', (err) => {
        reject(new BridgeNetworkError('Stream error: ' + err.message));
      });
    });

    req.on('error', (err) => reject(new BridgeNetworkError('Request error: ' + err.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new BridgeNetworkError('Request timed out after 120s'));
    });

    req.write(bodyStr);
    req.end();
  });
}

module.exports = {
  post,
  postStream,
  withCallerAuth,
  BridgeHttpError,
  BridgeNetworkError,
  parseRetryAfterSeconds,
};
