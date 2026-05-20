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
const bash = require('./tools/bash');
const permissions = require('./permissions');

const TOOLS = {
  list_files: listFiles,
  read_file: readFile,
  search_text: searchText,
  git_status: gitStatus,
  edit_file: editFile,
  write_file: writeFile,
  apply_patch: applyPatch,
  undo: undo,
  bash: bash,
};

/**
 * Get Anthropic tool definitions for all registered tools.
 * bash is only included when ctx.allowShell is true — the model never
 * sees it otherwise, so it won't ask to run commands.
 */
function getDefinitions(ctx) {
  return Object.entries(TOOLS)
    .filter(([name]) => name !== 'bash' || (ctx && ctx.allowShell))
    .map(([, tool]) => tool.definition());
}

/**
 * Check permissions, then execute (or return confirmation signal).
 *
 * Returns:
 *   On allow:  { ok: boolean, text: string, bytes?: number }
 *   On ask:    { ok: false, needsConfirmation: true, proposedAction: string, toolName: string, args: object }
 *   On deny:   { ok: false, text: 'Permission denied: ...' }
 */
function execute(toolName, args, ctx) {
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

  // decision === 'allow' — run the tool
  const tool = TOOLS[toolName];
  if (!tool) {
    return { ok: false, text: 'Unknown tool: ' + toolName };
  }

  try {
    return tool.execute(args, ctx);
  } catch (err) {
    return { ok: false, text: 'Tool error: ' + err.message };
  }
}

/**
 * Execute a tool WITHOUT checking permissions.
 * Used after the user explicitly approves a write or shell action.
 */
function executeForce(toolName, args, ctx) {
  const tool = TOOLS[toolName];
  if (!tool) {
    return { ok: false, text: 'Unknown tool: ' + toolName };
  }

  try {
    return tool.execute(args, ctx);
  } catch (err) {
    return { ok: false, text: 'Tool error: ' + err.message };
  }
}

module.exports = { getDefinitions, execute, executeForce };
