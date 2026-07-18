'use strict';

/**
 * Shell policy scanner — command-level checks beyond permission matrix.
 *
 * Honesty contract (P0-09): shell is unsandboxed local-account authority.
 * Regex scanning and --no-network are defense-in-depth only — not cwd
 * confinement and not a hard network / OS sandbox.
 */

const path = require('path');

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

const BLOCKED_BASENAMES = ['.env', '.env.local', '.env.production', '.env.development', '.envrc'];
const BLOCKED_PATTERNS = [
  /^\.env/i,
  /^credentials.*\.json$/i,
  /service[-_]?account.*\.json$/i,
  /firebase.*adminsdk.*\.json$/i,
  /^token.*$/i,
  /^.*\.pem$/i,
  /^.*\.key$/i,
  /^.*\.p8$/i,
  /^.*\.p12$/i,
  /^.*\.pfx$/i,
  /^.*_token$/i,
  /^.*secret.*$/i,
];

function isBlockedBasename(basename) {
  if (BLOCKED_BASENAMES.includes(basename)) return true;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(basename)) return true;
  }
  return false;
}

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
  if (isBlockedBasename(base)) return true;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(base)) return true;
  }
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

  return { allowed: issues.length === 0, issues };
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
  HARD_DENY_PATH_SEGMENTS,
  extractPathTokens,
  isBlockedPathToken,
  SHELL_AUTHORITY_SHORT,
  SHELL_AUTHORITY_HONESTY,
};
