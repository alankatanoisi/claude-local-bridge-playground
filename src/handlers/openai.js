'use strict';

/**
 * POST /v1/chat/completions — OpenAI Chat Completions format
 *
 * Converts OpenAI request → Anthropic request → proxies → converts response back.
 * Supports both streaming (stream: true) and non-streaming responses.
 */

const { readBody, sendJson, buildStreamChunk, log, verboseLog } = require('../utils');
const { resolveModel } = require('../models');
const {
  getCredentials,
  buildAuthHeaders,
  clearCredentialsCache,
  prependClaudeCodeSystem,
  messagesPathFor,
} = require('../credentials');
const https = require('https');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const vscode = require('vscode');

// ─────────────────────────────────────────────
// OpenAI → Anthropic conversion
// ─────────────────────────────────────────────

/**
 * Convert an OpenAI Chat Completions request body to an Anthropic Messages body.
 * @param {object} oai  OpenAI request body
 * @returns {object}    Anthropic request body
 */
function openAIToAnthropic(oai) {
  const messages = [];
  let systemPrompt = undefined;

  for (const msg of oai.messages || []) {
    if (msg.role === 'system') {
      // Anthropic has a top-level `system` field
      systemPrompt = systemPrompt ? systemPrompt + '\n\n' + msg.content : msg.content;
    } else if (msg.role === 'tool') {
      // OpenAI tool result → Anthropic tool_result content block
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          },
        ],
      });
    } else if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // OpenAI assistant tool_calls → Anthropic tool_use content blocks
      const content = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: (() => {
            try {
              return JSON.parse(tc.function.arguments);
            } catch {
              return {};
            }
          })(),
        });
      }
      messages.push({ role: 'assistant', content });
    } else {
      // user / assistant — normalise content
      let content = msg.content;
      if (Array.isArray(content)) {
        // OpenAI vision-style content parts
        content = content.map((part) => {
          if (part.type === 'text') return { type: 'text', text: part.text };
          if (part.type === 'image_url') {
            const url = part.image_url?.url || '';
            if (url.startsWith('data:')) {
              const [header, data] = url.split(',');
              const mediaType = header.replace('data:', '').replace(';base64', '');
              return {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data },
              };
            }
            return { type: 'image', source: { type: 'url', url } };
          }
          return part;
        });
      }
      messages.push({ role: msg.role, content });
    }
  }

  const body = {
    model: resolveModel(oai.model, vscode),
    messages,
    max_tokens: oai.max_tokens || 4096,
    stream: oai.stream || false,
  };

  if (systemPrompt) body.system = systemPrompt;
  if (oai.temperature !== undefined) body.temperature = oai.temperature;
  if (oai.top_p !== undefined) body.top_p = oai.top_p;
  if (oai.stop) body.stop_sequences = Array.isArray(oai.stop) ? oai.stop : [oai.stop];

  // Convert OpenAI tools → Anthropic tools
  if (oai.tools && oai.tools.length > 0) {
    body.tools = oai.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
  }

  // tool_choice
  if (oai.tool_choice) {
    if (oai.tool_choice === 'auto') body.tool_choice = { type: 'auto' };
    else if (oai.tool_choice === 'none') body.tool_choice = { type: 'none' };
    else if (typeof oai.tool_choice === 'object' && oai.tool_choice.function) {
      body.tool_choice = { type: 'tool', name: oai.tool_choice.function.name };
    }
  }

  return body;
}

// ─────────────────────────────────────────────
// Anthropic streaming SSE → OpenAI streaming SSE conversion
// ─────────────────────────────────────────────

/**
 * Convert Anthropic SSE stream to OpenAI SSE stream.
 * We buffer Anthropic SSE events and forward translated OpenAI chunks.
 */
function createAnthropicToOpenAIStreamConverter(res, completionId, modelName) {
  let buffer = '';

  return {
    write(chunk) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep partial line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          handleAnthropicEvent(res, event, completionId, modelName);
        } catch {
          // ignore parse errors
        }
      }
    },
    end() {
      // Flush remaining buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data && data !== '[DONE]') {
          try {
            const event = JSON.parse(data);
            handleAnthropicEvent(res, event, completionId, modelName);
          } catch {
            // ignore
          }
        }
      }
      // Send OpenAI [DONE]
      res.write('data: [DONE]\n\n');
      res.end();
    },
  };
}

function handleAnthropicEvent(res, event, completionId, modelName) {
  const type = event.type;

  if (type === 'content_block_delta') {
    const delta = event.delta;
    if (delta?.type === 'text_delta') {
      const chunk = buildStreamChunk(completionId, modelName, delta.text);
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    } else if (delta?.type === 'input_json_delta') {
      // Tool input streaming — send as partial content
      const chunk = buildStreamChunk(completionId, modelName, delta.partial_json || '');
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } else if (type === 'content_block_start') {
    if (event.content_block?.type === 'tool_use') {
      // Signal start of tool call
      const toolChunk = {
        id: completionId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: event.index,
                  id: event.content_block.id,
                  type: 'function',
                  function: { name: event.content_block.name, arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);
    }
  } else if (type === 'message_delta') {
    const stopReason = event.delta?.stop_reason;
    if (stopReason) {
      const finishReason =
        stopReason === 'end_turn'
          ? 'stop'
          : stopReason === 'tool_use'
            ? 'tool_calls'
            : stopReason === 'max_tokens'
              ? 'length'
              : 'stop';
      const finalChunk = buildStreamChunk(completionId, modelName, null, finishReason);
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    }
  }
}

// ─────────────────────────────────────────────
// Anthropic non-streaming → OpenAI non-streaming conversion
// ─────────────────────────────────────────────

/**
 * Convert an Anthropic Messages API response to OpenAI Chat Completions format.
 * @param {object} antResp  Parsed Anthropic response
 * @param {string} completionId
 * @returns {object}  OpenAI response
 */
function anthropicToOpenAI(antResp, completionId) {
  const model = antResp.model || 'unknown';
  const stopReason = antResp.stop_reason;
  const finishReason =
    stopReason === 'end_turn'
      ? 'stop'
      : stopReason === 'tool_use'
        ? 'tool_calls'
        : stopReason === 'max_tokens'
          ? 'length'
          : 'stop';

  // Extract text content
  let textContent = '';
  const toolCalls = [];

  for (const block of antResp.content || []) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const message = { role: 'assistant', content: textContent || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id: completionId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: antResp.usage?.input_tokens || 0,
      completion_tokens: antResp.usage?.output_tokens || 0,
      total_tokens: (antResp.usage?.input_tokens || 0) + (antResp.usage?.output_tokens || 0),
    },
  };
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────

async function handleChatCompletions(ctx, req, res) {
  const raw = await readBody(req);
  verboseLog(ctx, `→ /v1/chat/completions body: ${raw.slice(0, 300)}`);

  let oaiBody;
  try {
    oaiBody = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Invalid JSON body' } });
    return;
  }

  const antBody = openAIToAnthropic(oaiBody);
  // Reshape system field to match Claude Code's wire format when using OAuth.
  prependClaudeCodeSystem(ctx, antBody, getCredentials(ctx));
  const antBodyStr = JSON.stringify(antBody);
  const completionId = `chatcmpl-${randomUUID()}`;
  const isStream = oaiBody.stream === true;

  if (!isStream) {
    return handleChatCompletionsBuffered(ctx, res, antBodyStr, completionId);
  }

  // For streaming: we can't use proxyToAnthropic directly because we need to
  // intercept and convert the SSE events.
  return handleChatCompletionsStreaming(ctx, req, res, antBodyStr, antBody.model, completionId);
}

/**
 * Non-streaming: fetch full Anthropic response, convert to OpenAI format.
 */
async function handleChatCompletionsBuffered(ctx, res, antBodyStr, completionId, retry = false) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const configuredBaseUrl = config.get('anthropicBaseUrl', 'https://api.anthropic.com');

  // Prefer the host we observed Claude Code actually calling
  const baseUrl = ctx.interceptedHost
    ? `https://${ctx.interceptedHost}${ctx.interceptedPort && ctx.interceptedPort !== 443 ? `:${ctx.interceptedPort}` : ''}`
    : configuredBaseUrl;
  const creds = getCredentials(ctx);
  const apiPath = messagesPathFor(ctx, creds);
  const url = new URL(apiPath, baseUrl);
  const authHeaders = buildAuthHeaders(ctx, creds);
  const bodyBuf = Buffer.from(antBodyStr, 'utf8');

  return new Promise((resolve, reject) => {
    const upReq = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { ...authHeaders, 'content-length': bodyBuf.length },
        timeout: 300_000,
      },
      (upRes) => {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          // On 401: clear cache and retry once
          if (upRes.statusCode === 401 && !retry) {
            log(ctx, '⚠️ Received 401 (OpenAI path) — clearing credential cache and retrying');
            clearCredentialsCache(ctx);
            handleChatCompletionsBuffered(ctx, res, antBodyStr, completionId, true).then(resolve).catch(reject);
            return;
          }

          if (upRes.statusCode !== 200) {
            let errPayload;
            try {
              errPayload = JSON.parse(body);
            } catch {
              errPayload = { error: { type: 'upstream_error', message: body } };
            }
            sendJson(res, upRes.statusCode, errPayload);
            resolve();
            return;
          }

          try {
            const antResp = JSON.parse(body);
            const oaiResp = anthropicToOpenAI(antResp, completionId);
            sendJson(res, 200, oaiResp);
          } catch (err) {
            sendJson(res, 500, { error: { type: 'internal_error', message: err.message } });
          }
          resolve();
        });
        upRes.on('error', reject);
      },
    );
    upReq.on('error', reject);
    upReq.write(bodyBuf);
    upReq.end();
  });
}

/**
 * Streaming: convert Anthropic SSE events to OpenAI SSE events on-the-fly.
 */
async function handleChatCompletionsStreaming(ctx, _req, res, antBodyStr, modelName, completionId, retry = false) {
  const config = vscode.workspace.getConfiguration('claudeLocalBridge');
  const configuredBaseUrl = config.get('anthropicBaseUrl', 'https://api.anthropic.com');

  // Prefer the host we observed Claude Code actually calling
  const baseUrl = ctx.interceptedHost
    ? `https://${ctx.interceptedHost}${ctx.interceptedPort && ctx.interceptedPort !== 443 ? `:${ctx.interceptedPort}` : ''}`
    : configuredBaseUrl;
  const creds = getCredentials(ctx);
  const apiPath = messagesPathFor(ctx, creds);
  const url = new URL(apiPath, baseUrl);
  const authHeaders = buildAuthHeaders(ctx, creds);
  const bodyBuf = Buffer.from(antBodyStr, 'utf8');

  // Set up OpenAI SSE response headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.writeHead(200);
  if (res.flushHeaders) res.flushHeaders();
  if (res.socket?.setNoDelay) res.socket.setNoDelay(true);

  const converter = createAnthropicToOpenAIStreamConverter(res, completionId, modelName);

  return new Promise((resolve, reject) => {
    const upReq = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { ...authHeaders, 'content-length': bodyBuf.length },
        timeout: 300_000,
      },
      (upRes) => {
        // On 401: clear cache and retry once
        if (upRes.statusCode === 401 && !retry) {
          log(ctx, '⚠️ Received 401 (streaming) — clearing credential cache and retrying');
          clearCredentialsCache(ctx);
          upRes.resume(); // drain upstream
          handleChatCompletionsStreaming(ctx, _req, res, antBodyStr, modelName, completionId, true)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (upRes.statusCode !== 200) {
          const chunks = [];
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', () => {
            const errBody = Buffer.concat(chunks).toString('utf8');
            res.write(`data: ${errBody}\n\ndata: [DONE]\n\n`);
            res.end();
            resolve();
          });
          return;
        }

        upRes.on('data', (chunk) => converter.write(chunk));
        upRes.on('end', () => {
          converter.end();
          resolve();
        });
        upRes.on('error', (err) => {
          log(ctx, `Streaming upstream error: ${err.message}`, true);
          if (!res.writableEnded) res.end();
          resolve();
        });
      },
    );
    upReq.on('error', reject);
    upReq.write(bodyBuf);
    upReq.end();
  });
}

module.exports = { handleChatCompletions };
