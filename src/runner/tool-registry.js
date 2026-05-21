'use strict';

/**
 * tool-registry.js — Registers all tools and dispatches execution.
 *
 * Two execution modes:
 *   execute(toolName, args, ctx)       — checks permissions, may return 'ask' signal
 *   executeForce(toolName, args, ctx)  — skips permission check (for after approval)
 *
 * When execute() returns needsConfirmation: true, the caller (run.js) must
 * handle the interactive prompt and then call executeForce() if approved.
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

function getDefinitions(ctx) {
  return Object.entries(TOOLS)
    .filter(([name]) => {
      if (name === 'bash' && !(ctx && ctx.allowShell)) return false;
      if (ctx && ctx.allowedTools) return ctx.allowedTools.has(name);
      return true;
    })
    .map(([, tool]) => tool.definition());
}

/**
 * Run a tool and scrub secrets from its result text.
 * All tool results pass through scrubSecrets before being returned,
 * so API keys and tokens never appear in messages or transcripts.
 */
function runAndScrub(tool, args, ctx, toolUseId) {
  const toolCtx = toolUseId ? { ...ctx, toolUseId } : ctx;
  const result = tool.execute(args, toolCtx);
  if (result.text) {
    result.text = safety.scrubSecrets(result.text);
  }
  return result;
}

/**
 * Check permissions, then execute (or return confirmation signal).
 *
 * Returns:
 *   On allow:  { ok: boolean, text: string, bytes?: number }
 *   On ask:    { ok: false, needsConfirmation: true, proposedAction: string, toolName: string, args: object }
 *   On deny:   { ok: false, text: 'Permission denied: ...' }
 */
function execute(toolName, args, ctx, toolUseId) {
  const perm = permissions.check(toolName, args, ctx);

  if (perm.decision === 'deny') {
    return { ok: false, text: 'Permission denied: ' + perm.reason };
  }

  if (perm.decision === 'ask') {
    return {
      ok: false,
      needsConfirmation: true,
      proposedAction: perm.proposedAction,
      toolName,
      args,
    };
  }

  // decision === 'allow' — run the tool with secret scrubbing
  const tool = TOOLS[toolName];
  if (!tool) {
    return { ok: false, text: 'Unknown tool: ' + toolName };
  }

  try {
    return runAndScrub(tool, args, ctx, toolUseId);
  } catch (err) {
    return { ok: false, text: 'Tool error: ' + err.message };
  }
}

/**
 * Execute a tool WITHOUT checking permissions.
 * Used after the user explicitly approves a write or shell action.
 * Still scrubs secrets from results.
 */
function executeForce(toolName, args, ctx, toolUseId) {
  const tool = TOOLS[toolName];
  if (!tool) {
    return { ok: false, text: 'Unknown tool: ' + toolName };
  }

  // "Force" means the user already approved an ask-level action. It must not
  // bypass hard denies such as cwd escapes or secret-looking paths.
  const perm = permissions.check(toolName, args, { ...ctx, acceptEdits: true, dontAsk: true });
  if (perm.decision === 'deny') {
    return { ok: false, text: 'Permission denied: ' + perm.reason };
  }

  try {
    return runAndScrub(tool, args, ctx, toolUseId);
  } catch (err) {
    return { ok: false, text: 'Tool error: ' + err.message };
  }
}

module.exports = { getDefinitions, execute, executeForce };
