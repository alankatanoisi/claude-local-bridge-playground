'use strict';

/**
 * tool-registry.js — Canonical tool dispatcher.
 *
 * # Tool contract
 *
 * Every tool module exports `{ definition(), execute(args, ctx) }`. The
 * `execute` function may return:
 *
 *   - a synchronous `ToolResult`
 *   - a `Promise<ToolResult>` — awaited transparently by `runAndScrub`
 *   - a streaming `ToolResult` shaped as
 *       { ok, isStreaming: true, stream: AsyncIterable<string>, ... }
 *     which `runAndScrub` coalesces through `safety.makeStreamingScrubber()`
 *     into a final `text` while optionally forwarding chunks to
 *     `ctx.onToolChunk({ toolUseId, chunk })`.
 *
 * # ToolResult
 *
 * @typedef {Object} ToolResult
 * @property {boolean} ok — whether the tool succeeded; ok:false short-circuits
 *   the runner's success path and surfaces `text` as the error message.
 * @property {string} [text] — primary output. Gets secret-scrubbed in
 *   runAndScrub (or coalesced from `stream`), then optionally summarized by
 *   tool-result-summarizers, then attached to the envelope.
 * @property {number} [bytes] — size signal for logs/bench.
 * @property {boolean} [isStreaming] — when true, `stream` is consumed and
 *   `text` is reassembled by runAndScrub.
 * @property {AsyncIterable<string>} [stream] — required when isStreaming.
 * @property {boolean} [needsConfirmation] — caller must ask the user.
 * @property {string} [proposedAction] — human-readable action description
 *   shown alongside needsConfirmation.
 * @property {object} [permission] — populated by execute/executeForce with
 *   the permission decision; tools should not set this themselves.
 *
 * # Dispatcher entry points
 *
 *   - `execute(toolName, args, ctx, toolUseId): Promise<ToolResult>`
 *     Runs permissions.check; on `ask` returns a needsConfirmation result;
 *     on `deny` returns ok:false; otherwise runs the tool.
 *   - `executeForce(toolName, args, ctx, toolUseId): Promise<ToolResult>`
 *     Same shape, but permissions.check is invoked with acceptEdits:true.
 *     Used after the runner has resolved a confirmation, and by B3's
 *     parallel pre-pass.
 *   - `executeReadOnlyBatch(toolUses, ctx): Promise<Array<{toolUse, result}>>`
 *     Promise.allSettled fan-out for read-only tools; failures get a
 *     "stale state" note appended to surviving siblings.
 *
 * All three return Promises. Synchronous callers should `await`.
 */

const listFiles = require('./tools/list-files');
const readFile = require('./tools/read-file');
const searchText = require('./tools/search-text');
const gitStatus = require('./tools/git-status');
const editFile = require('./tools/edit-file');
const writeFile = require('./tools/write-file');
const applyPatch = require('./tools/apply-patch');
const undo = require('./tools/undo');
const undoEdit = require('./tools/undo-edit');
const bash = require('./tools/bash');
const permissions = require('./permissions');
const safety = require('./safety');
const { normalizeToolResult, resolveToolName } = require('./tool-envelope');
const { invalidateContextCache } = require('./context-budget');
const { maybeSummarize } = require('./tool-result-summarizers');
const searchCache = require('./tools/_search-cache');

const TOOLS = {
  list_files: listFiles,
  read_file: readFile,
  search_text: searchText,
  git_status: gitStatus,
  edit_file: editFile,
  write_file: writeFile,
  apply_patch: applyPatch,
  undo: undo,
  undo_edit: undoEdit,
  bash: bash,
};

const WRITE_TOOLS = new Set(['edit_file', 'write_file', 'apply_patch']);
const DEFAULT_HIDDEN_TOOLS = new Set(['apply_patch']);
const REDACTION_NOTICE =
  '[runner notice: this tool output was redacted for safety. Redacted snippets are not byte-exact; do not treat quotes or secret-like strings as exact source.]';

function getDefinitions(ctx) {
  return Object.entries(TOOLS)
    .filter(([name]) => {
      if (name === 'bash' && !(ctx && ctx.allowShell)) return false;
      if (ctx && ctx.allowedTools) return ctx.allowedTools.has(name);
      if (DEFAULT_HIDDEN_TOOLS.has(name)) return false;
      return true;
    })
    .map(([, tool]) => tool.definition());
}

// Tools may return:
//   - a plain { ok, text, ... } result (sync or async via Promise)
//   - a streaming { ok, isStreaming:true, stream: AsyncIterable<string>, ... }
//     result, which runAndScrub coalesces through a sliding-window scrubber
//     into a final `text` while honoring an optional chunk consumer on ctx.
async function runAndScrub(tool, args, ctx, toolUseId) {
  const started = Date.now();
  const toolCtx = toolUseId ? { ...ctx, toolUseId } : ctx;
  const result = await tool.execute(args, toolCtx);
  let redacted = false;

  if (result && result.isStreaming && result.stream) {
    const scrubber = safety.makeStreamingScrubber();
    let assembled = '';
    let bytes = 0;
    const HARD_CAP = 10 * 1024 * 1024;
    for await (const chunk of result.stream) {
      if (chunk === null || chunk === undefined) continue;
      const chunkStr =
        typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      bytes += Buffer.byteLength(chunkStr, 'utf8');
      if (bytes > HARD_CAP) {
        assembled += scrubber.end();
        assembled += '\n[stream truncated at ' + HARD_CAP + ' bytes]';
        break;
      }
      const scrubbed = scrubber.push(chunkStr);
      if (scrubbed) {
        assembled += scrubbed;
        if (ctx && typeof ctx.onToolChunk === 'function') {
          try {
            ctx.onToolChunk({ toolUseId, chunk: scrubbed });
          } catch {
            // chunk-consumer errors must not break the tool result
          }
        }
      }
    }
    const tail = scrubber.end();
    if (tail) {
      assembled += tail;
      if (ctx && typeof ctx.onToolChunk === 'function') {
        try {
          ctx.onToolChunk({ toolUseId, chunk: tail });
        } catch {
          // chunk-consumer errors must not break the tool result
        }
      }
    }
    delete result.stream;
    result.isStreaming = false;
    result.text = assembled;
    result.bytes = bytes;
    redacted = assembled.includes('[REDACTED');
  } else if (result && result.text) {
    const originalText = result.text;
    result.text = safety.scrubSecrets(originalText);
    redacted = result.text !== originalText;
  }

  // E4: boundary auto-summarization. Runs *after* scrubbing so dropped bytes
  // can't smuggle a secret past the redactor. Tools opt-in via the registry
  // in tool-result-summarizers.js; unregistered tools pass through unchanged.
  if (result && result.text) {
    let toolName = tool.name;
    if (!toolName && typeof tool.definition === 'function') {
      try {
        toolName = tool.definition().name;
      } catch {
        toolName = 'unknown';
      }
    }
    const summarized = maybeSummarize(toolName, result.text);
    if (summarized) {
      result._originalBytes = summarized.originalBytes;
      result.text = summarized.summary;
      result.summarized = true;
      result.droppedBytes = summarized.droppedBytes;
    }
  }

  if (result && result.text && redacted) {
    result.text = REDACTION_NOTICE + '\n' + result.text;
    result.redacted = true;
    result.safetyTags = [...new Set([...(result.safetyTags || []), 'redacted_tool_output'])];
  }

  const envelope = normalizeToolResult(result, {
    timing_ms: Date.now() - started,
    toolName: tool.name || 'unknown',
  });
  return { ...result, envelope };
}

function wrapPermissionResult(perm, toolName, args) {
  if (perm.decision === 'deny') {
    return {
      ok: false,
      text: 'Permission denied: ' + perm.reason,
      permission: perm,
    };
  }
  if (perm.decision === 'ask') {
    return {
      ok: false,
      needsConfirmation: true,
      proposedAction: perm.proposedAction,
      toolName,
      args,
      permission: perm,
    };
  }
  return null;
}

async function execute(toolName, args, ctx, toolUseId) {
  const resolved = resolveToolName(toolName);
  const canonical = resolved.canonical;
  const perm = permissions.check(canonical, args, ctx);
  const blocked = wrapPermissionResult(perm, canonical, args);
  if (blocked) return blocked;

  const tool = TOOLS[canonical];
  if (!tool) {
    return { ok: false, text: 'Unknown tool: ' + toolName };
  }

  try {
    const result = await runAndScrub(tool, args, ctx, toolUseId);
    if (WRITE_TOOLS.has(canonical) && result.ok) {
      invalidateContextCache();
      if (args && args.path) {
        safety.invalidateRealpathCache(ctx, [args.path]);
        permissions.invalidateDecisionCache(ctx, [args.path]);
        const path = require('path');
        const absPath = path.isAbsolute(args.path)
          ? args.path
          : path.resolve(ctx.cwdRealpath || ctx.cwd || process.cwd(), args.path);
        searchCache.invalidateForPath(absPath);
      }
    }
    if (resolved.aliasUsed) {
      result.envelope.aliasUsed = resolved.aliasUsed;
      result.envelope.canonicalTool = canonical;
    }
    result.permission = perm;
    return result;
  } catch (err) {
    return { ok: false, text: 'Tool error: ' + err.message, permission: perm };
  }
}

async function executeForce(toolName, args, ctx, toolUseId) {
  const resolved = resolveToolName(toolName);
  const canonical = resolved.canonical;
  const perm = permissions.check(canonical, args, { ...ctx, acceptEdits: true, dontAsk: true });
  if (permissions.isHardDeny(perm)) {
    return { ok: false, text: 'Permission denied: ' + perm.reason, permission: perm };
  }
  if (perm.decision === 'deny') {
    return { ok: false, text: 'Permission denied: ' + perm.reason, permission: perm };
  }

  const tool = TOOLS[canonical];
  if (!tool) {
    return { ok: false, text: 'Unknown tool: ' + toolName };
  }

  try {
    const result = await runAndScrub(tool, args, ctx, toolUseId);
    if (WRITE_TOOLS.has(canonical) && result.ok) {
      invalidateContextCache();
      if (args && args.path) {
        safety.invalidateRealpathCache(ctx, [args.path]);
        permissions.invalidateDecisionCache(ctx, [args.path]);
        const path = require('path');
        const absPath = path.isAbsolute(args.path)
          ? args.path
          : path.resolve(ctx.cwdRealpath || ctx.cwd || process.cwd(), args.path);
        searchCache.invalidateForPath(absPath);
      }
    }
    result.permission = perm;
    return result;
  } catch (err) {
    return { ok: false, text: 'Tool error: ' + err.message, permission: perm };
  }
}

/** Async batch execution for read-only tools with fail-fast annotation. */
async function executeReadOnlyBatch(toolUses, ctx) {
  const results = await Promise.allSettled(
    toolUses.map((tu) => Promise.resolve().then(() => execute(tu.name, tu.input || {}, ctx, tu.id))),
  );
  let anyFailed = false;
  const ordered = results.map((r, i) => {
    const base = r.status === 'fulfilled' ? r.value : { ok: false, text: 'Tool error: ' + r.reason };
    if (!base.ok) anyFailed = true;
    return { toolUse: toolUses[i], result: base };
  });
  if (anyFailed) {
    for (const entry of ordered) {
      if (entry.result.ok) {
        entry.result.text =
          (entry.result.text || '') +
          '\n[Note: some reads in this batch failed — this result may reflect stale state.]';
        if (entry.result.envelope) {
          entry.result.envelope.text = entry.result.text;
        }
      }
    }
  }
  return ordered;
}

module.exports = {
  getDefinitions,
  execute,
  executeForce,
  executeReadOnlyBatch,
  TOOLS,
  WRITE_TOOLS,
  DEFAULT_HIDDEN_TOOLS,
};
