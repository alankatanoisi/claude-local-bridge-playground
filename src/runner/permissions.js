'use strict';

/**
 * permissions.js — Category-based safety gate with realpath confinement.
 *
 * Returns one of:
 *   { decision: 'allow' }
 *   { decision: 'ask',   proposedAction: string }   — needs user confirmation
 *   { decision: 'deny',  reason: string }
 *
 * Path checking now uses realpath (via safety.confinePath) to defeat symlink
 * escapes. The deny matrix (safety.isPathBlockedByDenyMatrix) handles
 * glob-like patterns: ** /.env, ** /.ssh/**, ** /id_rsa*, ** /*.pem, etc.
 */

const path = require('path');
const safety = require('./safety');

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
  undo_edit: 'write',
  bash: 'shell',
};

// ---------------------------------------------------------------------------
// Legacy exports for existing tests (these are superseded by safety.js)
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

function isInsideProject(requestedPath, cwd) {
  if (path.isAbsolute(requestedPath)) return false;
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
// Main check — enhanced with realpath and deny matrix
// ---------------------------------------------------------------------------

/**
 * Decide whether to allow, ask, or deny a tool call.
 *
 * Path confinement now uses fs.realpathSync to catch symlink escapes.
 * The deny matrix catches sensitive paths regardless of basename.
 *
 * @param {string} toolName
 * @param {object}  args     — tool arguments
 * @param {object}  ctx      — { cwd, cwdRealpath?, acceptEdits?, dontAsk?, allowShell? }
 * @returns {{ decision: string, reason?: string, proposedAction?: string }}
 */
function check(toolName, args, ctx) {
  // Ensure cwdRealpath is set (populated by validateCwd at startup)
  if (!ctx.cwdRealpath && ctx.cwd) {
    try {
      const fs = require('fs');
      ctx.cwdRealpath = fs.realpathSync(ctx.cwd);
    } catch {
      ctx.cwdRealpath = ctx.cwd; // fallback
    }
  }

  // --- Path-based guardrails (applies to any tool that has a 'path' arg) ---
  const requestedPath = args && args.path;
  if (requestedPath) {
    // Step 1: realpath-based containment (catches symlink escapes)
    const confined = safety.confinePath(ctx, requestedPath);
    if (!confined) {
      return { decision: 'deny', reason: 'Path escapes working directory: ' + requestedPath };
    }

    // Step 2: deny matrix (glob-like patterns for sensitive paths)
    if (safety.isPathBlockedByDenyMatrix(confined)) {
      return { decision: 'deny', reason: 'Blocked file type (potential secret): ' + path.basename(requestedPath) };
    }
  }

  // --- Shell argument scanning: reject commands that reference deny-matrix paths ---
  if (toolName === 'bash' && args && args.command) {
    const cmd = args.command;
    // Check for attempts to access sensitive paths in the command text
    const blockedSegments = [
      '.env',
      '.ssh/',
      '.aws/',
      '.claude/',
      '.gnupg/',
      'id_rsa',
      'id_ed25519',
      '.pem',
      '.key',
      '.netrc',
      '.npmrc',
      'credentials.json',
    ];
    for (const seg of blockedSegments) {
      if (cmd.includes(seg)) {
        return { decision: 'deny', reason: 'Shell command references a blocked path pattern: ' + seg };
      }
    }
    // Block attempts to read env vars that would leak credentials
    const blockedEnvRefs = [
      '$SSH_AUTH_SOCK',
      '${SSH_AUTH_SOCK}',
      '$AWS_ACCESS_KEY_ID',
      '${AWS_ACCESS_KEY_ID}',
      '$ANTHROPIC_API_KEY',
      '${ANTHROPIC_API_KEY}',
      '$GH_TOKEN',
      '${GH_TOKEN}',
    ];
    for (const ref of blockedEnvRefs) {
      if (cmd.includes(ref)) {
        return { decision: 'deny', reason: 'Shell command references a blocked environment variable: ' + ref };
      }
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
    if (toolName === 'undo' || toolName === 'undo_edit') {
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

  return { decision: 'deny', reason: 'Unknown permission category.' };
}

// ---------------------------------------------------------------------------
// Helpers
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
