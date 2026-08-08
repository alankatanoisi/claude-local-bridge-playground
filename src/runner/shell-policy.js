'use strict';

/**
 * Shell policy scanner — command-level checks beyond permission matrix.
 *
 * Honesty contract (P0-09): shell is unsandboxed local-account authority.
 * Regex scanning and --no-network are defense-in-depth only — not cwd
 * confinement and not a hard network / OS sandbox.
 */

const path = require('path');
// A11: sensitive-filename matching lives in safety.js as the single source of
// truth. shell-policy used to keep its own copy, which had drifted to a strict
// subset — shell permitted `.netrc`, `.npmrc`, and `id_rsa` basenames that the
// file tools already denied. Importing the shared list closes that asymmetry.
const { isBlockedBasename } = require('./safety');

/** Short label for CLI flags, banners, and compact warnings. */
const SHELL_AUTHORITY_SHORT =
  'unsandboxed local-account authority (starts in --cwd; not cwd confinement; --no-network is best-effort only)';

/**
 * Full honesty sentence shared by tool descriptions, confirmations, and docs.
 * Every shell-enabling surface should surface this meaning.
 */
const SHELL_AUTHORITY_HONESTY =
  'Shell is unsandboxed local-account authority: commands start in --cwd but can ' +
  'read/write absolute paths outside it, spawn processes, and reach the network ' +
  'unless separately constrained. Regex scanning and --no-network are defense-in-depth, not OS isolation.';

const NETWORK_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnc\b/i,
  /\bncat\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b.*@/i,
  /\bnpm\s+publish\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+fetch\b/i,
  /\bgit\s+pull\b/i,
];

const HARD_DENY_PATH_SEGMENTS = ['.git/', '.ssh/', '.aws/', '.claude/', '.bridge-runner/', 'actions-runner/'];

// D2 (2026-08-07 incident): git verbs that mutate repository history or move
// HEAD. These always require a fresh confirmation — automation flags
// (--accept-edits / --dont-ask) must never imply consent to commit, push, or
// switch branches, because that is exactly how uncommitted multi-author work
// got swept into one commit and how an unattended branch switch redirected a
// human's commit. Read-only git verbs (status/log/diff/show) are deliberately
// absent so ordinary inspection stays frictionless.
const GIT_STATE_VERBS = ['commit', 'push', 'checkout', 'switch', 'merge'];

// Match `git <verb>`, tolerating global options like `git -C path commit` or
// `git --no-pager checkout`. Only the FIRST git subcommand token is inspected.
const GIT_STATE_VERB_PATTERN = new RegExp(
  '\\bgit\\s+(?:-[^\\s]+(?:\\s+[^\\s-][^\\s]*)?\\s+)*(' + GIT_STATE_VERBS.join('|') + ')\\b',
);

/**
 * Return the first history-mutating git verb in a command, or null.
 * ctx-independent: the git consent gate applies whenever shell is enabled.
 */
function detectGitStateChange(command) {
  const m = String(command || '').match(GIT_STATE_VERB_PATTERN);
  return m ? m[1] : null;
}

/**
 * D3 (best-effort worktree confinement): when a worktree is active, a bash
 * command that references the ORIGINAL checkout's path is trying to reach back
 * out of the isolated tree. Return the matched root string, or null.
 *
 * Honesty caveat (kept in docs too): this blocks path-STRING references to the
 * original root. It is not OS isolation — a novel absolute path outside both
 * roots, or a relative-path trick, remains shell-authority territory. It closes
 * the OBSERVED escape (agents cd/edit back into the original checkout by path).
 */
function detectWorktreeEscape(command, ctx) {
  if (!ctx || !ctx.activeWorktreeSlot || !ctx.worktreeRepoRoot) return null;
  const cmd = String(command || '');
  const activePath = String(ctx.cwdRealpath || ctx.cwd || '');
  const roots = [ctx.worktreeRepoRoot.repoRoot, ctx.worktreeRepoRoot.cwd, ctx.worktreeRepoRoot.cwdRealpath]
    .filter((p) => typeof p === 'string' && p.length > 0)
    // Never flag the active worktree path itself, even if it nests oddly.
    .filter((p) => p !== activePath);
  for (const root of roots) {
    if (cmd.includes(root)) return root;
  }
  return null;
}

const BLOCKED_ENV_VAR_PATTERNS = [
  /\$ANTHROPIC_/i,
  /\$AWS_/i,
  /\$OPENAI_/i,
  /\$GH_TOKEN/i,
  /\$GITHUB_TOKEN/i,
  /\$NPM_TOKEN/i,
  /\$CLAUDE_/i,
  /\$\{?ANTHROPIC_/i,
  /\$\{?AWS_/i,
];

const BLOCKED_PATH_TOKENS = ['.env', '../.env', '/.env', '.env.local', '.env.production'];

function extractPathTokens(command) {
  const tokens = [];
  const redirectMatches = command.match(/(?:>>?|\|)\s*([^\s|;&]+)/g) || [];
  for (const m of redirectMatches) {
    tokens.push(m.replace(/^(>>?|\|)\s*/, '').trim());
  }
  const argMatches = command.match(/(?:cat|head|tail|less|more|grep|node|python3?|php|ruby)\s+([^\s|;&]+)/gi) || [];
  for (const m of argMatches) {
    const parts = m.split(/\s+/);
    if (parts[1]) tokens.push(parts[1]);
  }
  if (/\bcat\b/i.test(command)) {
    const catArgs = command.match(/\bcat\b[^\n|;&]*/i);
    if (catArgs) {
      for (const part of catArgs[0].split(/\s+/).slice(1)) {
        if (part && !part.startsWith('-')) tokens.push(part);
      }
    }
  }
  return tokens;
}

function isBlockedPathToken(token) {
  const t = String(token || '').replace(/^['"]|['"]$/g, '');
  if (!t) return false;
  const base = path.basename(t);
  // One basename check, not two: the loop that used to follow this line
  // re-tested the exact same pattern array isBlockedBasename already walks.
  if (isBlockedBasename(base)) return true;
  for (const seg of HARD_DENY_PATH_SEGMENTS) {
    if (t.includes(seg)) return true;
  }
  for (const blocked of BLOCKED_PATH_TOKENS) {
    if (t === blocked || t.endsWith('/' + blocked) || t.includes(blocked)) return true;
  }
  if (/\.env/i.test(t)) return true;
  if (/\.ssh/i.test(t)) return true;
  return false;
}

function scanShellCommand(command, ctx = {}) {
  const cmd = String(command || '');
  const issues = [];

  for (const seg of HARD_DENY_PATH_SEGMENTS) {
    if (cmd.includes(seg)) {
      issues.push({ kind: 'hard_deny_path', segment: seg });
    }
  }

  for (const blocked of BLOCKED_PATH_TOKENS) {
    if (cmd.includes(blocked)) {
      issues.push({ kind: 'blocked_path_pattern', token: blocked });
    }
  }

  for (const token of extractPathTokens(cmd)) {
    if (isBlockedPathToken(token)) {
      issues.push({ kind: 'blocked_path_pattern', token });
    }
  }

  for (const pat of BLOCKED_ENV_VAR_PATTERNS) {
    if (pat.test(cmd)) {
      issues.push({ kind: 'blocked_env_var', pattern: pat.source });
    }
  }

  if (ctx.noNetwork) {
    for (const pat of NETWORK_PATTERNS) {
      if (pat.test(cmd)) {
        issues.push({ kind: 'network_command', pattern: pat.source });
      }
    }
  }

  // D3: worktree escape is a hard deny — reaching the original checkout by path
  // defeats the whole point of --worktree isolation.
  const escapeRoot = detectWorktreeEscape(cmd, ctx);
  if (escapeRoot) {
    issues.push({ kind: 'worktree_escape_path', token: escapeRoot });
  }

  // D2: history-mutating git verbs require a fresh confirmation. This is an
  // ASK, not a deny, so it must NOT flip `allowed` — background-shell and
  // hook-runner treat `!allowed` as a hard block, and a git verb should reach
  // the interactive confirmation flow (permissions.js), not be silently killed.
  const gitVerb = detectGitStateChange(cmd);
  if (gitVerb) {
    issues.push({ kind: 'git_state_change', verb: gitVerb });
  }

  // `allowed` reflects only hard-deny-class issues. git_state_change is an ask
  // signal carried in `issues` for the permission gate to act on; it does not
  // block the non-interactive callers.
  const hardIssues = issues.filter((i) => i.kind !== 'git_state_change');
  return { allowed: hardIssues.length === 0, issues };
}

function validateChaosCombo(flags) {
  const risky = flags.allowShell && flags.acceptEdits && flags.dontAsk;
  if (risky && !flags.chaosOk) {
    return {
      allowed: false,
      reason: 'Flag combo --allow-shell --accept-edits --dont-ask requires --chaos-ok',
    };
  }
  return { allowed: true };
}

module.exports = {
  scanShellCommand,
  validateChaosCombo,
  detectGitStateChange,
  detectWorktreeEscape,
  HARD_DENY_PATH_SEGMENTS,
  GIT_STATE_VERBS,
  extractPathTokens,
  isBlockedPathToken,
  SHELL_AUTHORITY_SHORT,
  SHELL_AUTHORITY_HONESTY,
};
