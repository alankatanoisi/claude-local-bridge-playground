'use strict';

/**
 * Shell policy scanner — command-level checks beyond permission matrix.
 *
 * Honesty contract (P0-09): shell is unsandboxed local-account authority.
 * Regex scanning and --no-network are defense-in-depth only — not cwd
 * confinement and not a hard network / OS sandbox.
 */

const path = require('path');
const fs = require('fs');
// A11: sensitive-filename matching lives in safety.js as the single source of
// truth. shell-policy used to keep its own copy, which had drifted to a strict
// subset — shell permitted `.netrc`, `.npmrc`, and `id_rsa` basenames that the
// file tools already denied. Importing the shared list closes that asymmetry.
const { isBlockedBasename } = require('./safety');
// The authority ceiling makes --no-network a one-way restriction: checks below
// must consult the ceiling-clamped (effective) flag, not the mutable ctx flag,
// so clearing ctx.noNetwork mid-run cannot drop the startup network guard.
const { effectiveFlags } = require('./authority');

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

const HARD_DENY_PATH_SEGMENTS = [
  '.git/',
  '.ssh/',
  '.aws/',
  '.claude/',
  '.gnupg/',
  '.bridge-runner/',
  'actions-runner/',
];

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

// Read shell words without executing them. Adjacent quoted pieces belong to
// ONE word: I"D"_RSA and ID_''RSA both become ID_RSA. Keep wildcard positions
// separately: quoted/escaped stars are literal characters, not expansions.
function shellWords(command) {
  const words = [];
  let value = '';
  let glob = '';
  let quote = null;
  let started = false;
  let hasGlob = false;
  function flush() {
    if (started) words.push({ value, glob, hasGlob });
    value = '';
    glob = '';
    started = false;
    hasGlob = false;
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'") {
      const next = command[i + 1];
      // In double quotes, Bash preserves a backslash before ordinary letters.
      if (next && (!quote || /[\\"$`\n]/.test(next))) {
        i++;
        if (next !== '\n') {
          value += next;
          glob += /[*?[]/.test(next) ? '[' + next + ']' : next;
        }
      } else {
        value += ch;
        glob += ch;
      }
      started = true;
    } else if (quote) {
      if (ch === quote) quote = null;
      else {
        value += ch;
        glob += /[*?[]/.test(ch) ? '[' + ch + ']' : ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s|[|;&<>]/.test(ch)) {
      flush();
      if (!/\s/.test(ch)) words.push({ value: ch, operator: true });
    } else {
      started = true;
      value += ch;
      glob += ch;
      if (/[*?[]/.test(ch)) hasGlob = true;
    }
  }
  flush();
  return words;
}

function extractPathWords(command) {
  const tokens = [];
  let executable = null;
  let position = 0;
  let inlineCode = false;
  let redirect = false;
  for (const word of shellWords(String(command || ''))) {
    if (word.operator) {
      if (word.value === '<' || word.value === '>') redirect = true;
      else {
        executable = null;
        position = 0;
      }
      continue;
    }
    const token = word.value;
    if (redirect) {
      tokens.push(word);
      redirect = false;
      continue;
    }
    if (!executable) {
      executable = path.posix.basename(token);
      continue;
    }
    position++;
    if (inlineCode) {
      // Interpreter code is data, not a filename. This does not sandbox code;
      // explicit shell access already grants interpreter execution authority.
      inlineCode = false;
      continue;
    }
    if (
      (/^(node|ruby|perl)$/.test(executable) && /^(?:-e|-p|--eval|--print)$/.test(token)) ||
      (/^python[0-9.]*$/.test(executable) && token === '-c')
    ) {
      inlineCode = true;
      continue;
    }
    if (token.startsWith('-')) continue;
    // These commands print their operands as data; redirects were checked above.
    if (executable === 'printf' || executable === 'echo') continue;
    // Preserve ordinary grep search words while still inspecting path operands
    // and private-key names regardless of executable or argument position.
    if (
      executable === 'cat' ||
      (position === 1 && /^(head|tail|less|more|grep|node|python[0-9.]*|php|ruby)$/.test(executable)) ||
      /[\\/.]/.test(token) ||
      /^id_(?:rsa|ed25519)/i.test(token) ||
      word.hasGlob
    )
      tokens.push(word);
  }
  return tokens;
}

function extractPathTokens(command) {
  return extractPathWords(command).map((word) => word.value);
}

// Wildcards are expanded only against project metadata, never by a shell.
// Bound the walk and fail closed for unsupported or unbounded expansion forms.
// Checking matches keeps ordinary globs such as src/*.js usable.
function globPathBlocked(word, ctx) {
  if (!word.hasGlob) return false;
  const root = ctx.cwdRealpath || ctx.cwd;
  if (!root || /[{}$`~]/.test(word.glob)) return true;
  const parts = word.glob.split('/');
  if (path.isAbsolute(word.glob) || parts.includes('..') || parts.includes('**')) return true;
  let candidates = [root];
  let budget = 2000;
  try {
    for (const part of parts) {
      const next = [];
      if (part === '.') continue;
      // Match one directory level at a time. This works on older Node versions
      // too, without introducing a shell parser or a glob-library dependency.
      let expression = '^';
      for (let i = 0; i < part.length; i++) {
        const ch = part[i];
        if (ch === '*') expression += '.*';
        else if (ch === '?') expression += '.';
        else if (ch === '[') {
          const end = part.indexOf(']', i + 1);
          if (end < 0) return true;
          const body = part.slice(i + 1, end).replace(/^!/, '^');
          expression += '[' + body + ']';
          i = end;
        } else expression += ch.replace(/[\\^$+?.()|{}\]]/g, '\\$&');
      }
      const matcher = new RegExp(expression + '$');
      for (const parent of candidates) {
        if (!fs.statSync(parent).isDirectory()) continue;
        if (!/[*?[]/.test(part)) {
          // Let the filesystem resolve literal directory spelling. On a Mac,
          // `src/*` may refer to an actual directory named `SRC`.
          const full = path.join(parent, part);
          if (!fs.existsSync(full)) continue;
          if (isBlockedPathToken(full) || isBlockedPathToken(fs.realpathSync(full))) return true;
          next.push(full);
          continue;
        }
        for (const entry of fs.readdirSync(parent)) {
          // Bash's ordinary wildcards do not match dotfiles unless the pattern
          // itself starts with a dot. Exact dot-paths still get checked below.
          if (entry.startsWith('.') && !part.startsWith('.')) continue;
          if (!matcher.test(entry)) continue;
          if (--budget < 0) return true;
          const full = path.join(parent, entry);
          if (isBlockedPathToken(full) || isBlockedPathToken(fs.realpathSync(full))) return true;
          next.push(full);
        }
      }
      candidates = next;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Return the canonical protected-directory label found in one shell token.
 *
 * A label such as `.ssh/` is stored with its slash because that is the useful
 * text shown in an error. For comparison, the slash is removed and the token
 * is split into exact path segments. This catches both `~/.SSH/config` and a
 * token ending exactly at `~/.SSH`, without misreading `.ssh-notes` as `.ssh`.
 *
 * @param {string} token
 * @returns {string|null}
 */
function findHardDenyPathSegment(token) {
  const segments = String(token || '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.toLowerCase());

  for (const label of HARD_DENY_PATH_SEGMENTS) {
    const protectedName = label.replace(/\/$/, '').toLowerCase();
    if (segments.includes(protectedName)) return label;
  }
  return null;
}

function isBlockedPathToken(token) {
  const t = String(token || '').replace(/^['"]|['"]$/g, '');
  if (!t) return false;
  // Normalize Windows separators before asking for the final filename. That
  // keeps a transcript containing `C:\\work\\ID_RSA` protected on a Mac too.
  const portableToken = t.replace(/\\/g, '/');
  const base = path.posix.basename(portableToken);
  // Keep the shell's duplicate raw-string checks case-insensitive too. The
  // shared basename helper below already has that contract, but directory
  // fragments can be found here before the shell resolves a real filesystem
  // path, so they must not depend on the host filesystem's case behavior.
  const normalizedToken = t.toLowerCase();
  // One basename check, not two: the loop that used to follow this line
  // re-tested the exact same pattern array isBlockedBasename already walks.
  if (isBlockedBasename(base)) return true;
  if (findHardDenyPathSegment(t)) return true;
  for (const blocked of BLOCKED_PATH_TOKENS) {
    const normalizedBlocked = blocked.toLowerCase();
    if (
      normalizedToken === normalizedBlocked ||
      normalizedToken.endsWith('/' + normalizedBlocked) ||
      normalizedToken.includes(normalizedBlocked)
    ) {
      return true;
    }
  }
  if (/\.env/i.test(t)) return true;
  if (/\.ssh/i.test(t)) return true;
  return false;
}

function scanShellCommand(command, ctx = {}) {
  const cmd = String(command || '');
  // Commands are still executed with their original spelling. This lowercase
  // copy exists only for conservative safety comparisons such as `.SSH/`.
  const normalizedCommand = cmd.toLowerCase();
  const issues = [];

  for (const seg of HARD_DENY_PATH_SEGMENTS) {
    if (normalizedCommand.includes(seg.toLowerCase())) {
      issues.push({ kind: 'hard_deny_path', segment: seg });
    }
  }

  for (const blocked of BLOCKED_PATH_TOKENS) {
    if (normalizedCommand.includes(blocked.toLowerCase())) {
      issues.push({ kind: 'blocked_path_pattern', token: blocked });
    }
  }

  for (const word of extractPathWords(cmd)) {
    const token = word.value;
    // A prior cd changes where Bash expands a glob. We cannot safely validate
    // that expansion using the startup folder, so reject this combined form.
    if ((word.hasGlob && /\b(?:cd|pushd|popd)\b/.test(cmd)) || globPathBlocked(word, ctx)) {
      issues.push({ kind: 'blocked_path_pattern', token });
    }
    const hardSegment = findHardDenyPathSegment(token);
    if (hardSegment) {
      issues.push({ kind: 'hard_deny_path', segment: hardSegment });
    } else if (isBlockedPathToken(token)) {
      issues.push({ kind: 'blocked_path_pattern', token });
    }
  }

  for (const pat of BLOCKED_ENV_VAR_PATTERNS) {
    if (pat.test(cmd)) {
      issues.push({ kind: 'blocked_env_var', pattern: pat.source });
    }
  }

  // Effective, not raw: with a startup no-network ceiling, this still emits
  // after ctx.noNetwork is cleared mid-run (thermo-nuclear F1). Without a
  // ceiling, effectiveFlags falls back to the raw flag — behavior unchanged.
  if (effectiveFlags(ctx).noNetwork) {
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
