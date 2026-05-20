'use strict';

/**
 * permissions.js — Category-based safety gate.
 *
 * Returns one of:
 *   { decision: 'allow' }
 *   { decision: 'ask',   proposedAction: string }   — needs user confirmation
 *   { decision: 'deny',  reason: string }
 *
 * Categories:
 *   read-only  → always allow (list_files, read_file, search_text, git_status)
 *   write      → ask by default, allow when ctx.acceptEdits is true
 *   shell      → ask by default, allow when ctx.dontAsk is true; blocked entirely when ctx.allowShell is false
 *
 * Path/secret rules (apply to ALL tools with a path argument):
 *   - absolute paths              → deny
 *   - paths escaping cwd          → deny
 *   - secret-looking basenames    → deny
 *   - paths in blocked dirs       → deny
 */

const path = require('path');

// ---------------------------------------------------------------------------
// Categories — these govern the default decision for each tool
// ---------------------------------------------------------------------------

const CATEGORIES = {
  list_files: 'read-only',
  read_file: 'read-only',
  search_text: 'read-only',
  git_status: 'read-only',
  edit_file: 'write',
  write_file: 'write',
  apply_patch: 'write',
  undo: 'write',
  bash: 'shell',
};

// ---------------------------------------------------------------------------
// Secret / sensitive file blocking (applies to read AND write tools)
// ---------------------------------------------------------------------------

const BLOCKED_BASENAMES = ['.env', '.env.local', '.env.production', '.env.development'];

const BLOCKED_PATTERNS = [
  /^credentials.*\.json$/i,
  /^token.*$/i,
  /^.*\.pem$/i,
  /^.*\.key$/i,
  /^.*_token$/i,
  /^.*secret.*$/i,
];

const BLOCKED_DIRS = ['.git', 'node_modules', 'dist', 'build', 'coverage'];

// ---------------------------------------------------------------------------
// Path containment check
// ---------------------------------------------------------------------------

/**
 * Returns true if requestedPath (relative) stays inside cwd.
 * Absolute paths are always rejected.
 */
function isInsideProject(requestedPath, cwd) {
  if (path.isAbsolute(requestedPath)) {
    return false;
  }
  const resolved = path.resolve(cwd, requestedPath);
  const normalizedCwd = path.resolve(cwd);
  return resolved.startsWith(normalizedCwd + path.sep) || resolved === normalizedCwd;
}

function isBlockedBasename(basename) {
  if (BLOCKED_BASENAMES.includes(basename)) return true;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(basename)) return true;
  }
  return false;
}

function isBlockedDir(basename) {
  return BLOCKED_DIRS.includes(basename);
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * Decide whether to allow, ask, or deny a tool call.
 *
 * @param {string} toolName
 * @param {object}  args     — tool arguments
 * @param {object}  ctx      — { cwd, acceptEdits?, dontAsk?, allowShell? }
 * @returns {{ decision: string, reason?: string, proposedAction?: string }}
 */
function check(toolName, args, ctx) {
  const cwd = ctx.cwd || process.cwd();

  // --- Path-based guardrails (applies to any tool that has a 'path' arg) ---
  const requestedPath = args && args.path;
  if (requestedPath) {
    if (!isInsideProject(requestedPath, cwd)) {
      return { decision: 'deny', reason: 'Path escapes working directory: ' + requestedPath };
    }
    const basename = path.basename(requestedPath);
    if (isBlockedBasename(basename)) {
      return { decision: 'deny', reason: 'Blocked file type (potential secret): ' + basename };
    }
  }

  // --- Category-based decision ---
  const category = CATEGORIES[toolName];
  if (!category) {
    return { decision: 'deny', reason: "Tool '" + toolName + "' is not in the allow-list." };
  }

  if (category === 'read-only') {
    return { decision: 'allow' };
  }

  if (category === 'write') {
    // undo is recovery — always auto-approve
    if (toolName === 'undo') {
      return { decision: 'allow' };
    }
    if (ctx.acceptEdits) {
      return { decision: 'allow' };
    }
    return { decision: 'ask', proposedAction: describeWriteAction(toolName, args) };
  }

  if (category === 'shell') {
    if (!ctx.allowShell) {
      return { decision: 'deny', reason: 'Shell commands are disabled. Use --allow-shell to enable.' };
    }
    if (ctx.dontAsk) {
      return { decision: 'allow' };
    }
    return { decision: 'ask', proposedAction: describeShellAction(args) };
  }

  // Fallback — should not reach here
  return { decision: 'deny', reason: 'Unknown permission category.' };
}

// ---------------------------------------------------------------------------
// Helpers for human-readable action descriptions (shown during confirmation)
// ---------------------------------------------------------------------------

function describeWriteAction(toolName, args) {
  const file = args.path || args.file_path || '(unknown file)';
  if (toolName === 'edit_file') {
    const snippet = (args.new_string || '').slice(0, 80);
    return 'Edit ' + file + ' — replace string → "' + snippet + (snippet.length >= 80 ? '...' : '') + '"';
  }
  if (toolName === 'write_file') {
    const bytes = args.content ? Buffer.byteLength(args.content, 'utf8') : 0;
    return 'Write ' + file + ' (' + bytes + ' bytes)';
  }
  if (toolName === 'apply_patch') {
    return 'Apply patch to ' + file;
  }
  return toolName + ' on ' + file;
}

function describeShellAction(args) {
  const cmd = args.command || '(no command)';
  return 'Run: ' + (cmd.length > 100 ? cmd.slice(0, 97) + '...' : cmd);
}

module.exports = {
  check,
  isInsideProject,
  isBlockedBasename,
  isBlockedDir,
  BLOCKED_DIRS,
  CATEGORIES,
};
