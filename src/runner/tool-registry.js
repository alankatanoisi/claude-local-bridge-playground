'use strict';

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

function getDefinitions(ctx) {
  return Object.entries(TOOLS)
    .filter(([name]) => {
      if (name === 'bash' && !(ctx && ctx.allowShell)) return false;
      if (ctx && ctx.allowedTools) return ctx.allowedTools.has(name);
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

  if (result && result.isStreaming && result.stream) {
    const scrubber = safety.makeStreamingScrubber();
    let assembled = '';
    let bytes = 0;
    const HARD_CAP = 10 * 1024 * 1024;
    for await (const chunk of result.stream) {
      if (chunk === null || chunk === undefined) continue;
      const chunkStr = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
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
  } else if (result && result.text) {
    result.text = safety.scrubSecrets(result.text);
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
      if (args && args.path) safety.invalidateRealpathCache(ctx, [args.path]);
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
      if (args && args.path) safety.invalidateRealpathCache(ctx, [args.path]);
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

module.exports = { getDefinitions, execute, executeForce, executeReadOnlyBatch, TOOLS, WRITE_TOOLS };
