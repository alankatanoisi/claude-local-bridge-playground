'use strict';

/**
 * permissions.js — Category-based safety gate with severity levels and explainer metadata.
 */

const path = require('path');
const safety = require('./safety');
// CATEGORIES is derived from each tool module's own meta — see tool-catalog.js.
const { CATEGORIES } = require('./tool-catalog');
const { normalizeSlot, inspectWorktreeStatus } = require('./worktree-utils');
const { SHELL_AUTHORITY_SHORT } = require('./shell-policy');

const MODES = {
  default: {
    'read-only': 'allow',
    write: 'ask',
    shell: 'ask',
    recovery: 'allow',
    orchestration: 'ask',
    worktree: 'ask',
  },
  acceptEdits: {
    'read-only': 'allow',
    write: 'allow',
    shell: 'ask',
    recovery: 'allow',
    orchestration: 'ask',
    worktree: 'allow',
  },
  dontAsk: {
    'read-only': 'allow',
    write: 'ask',
    shell: 'allow',
    recovery: 'allow',
    orchestration: 'allow',
    worktree: 'allow',
  },
  acceptEditsAndDontAsk: {
    'read-only': 'allow',
    write: 'allow',
    shell: 'allow',
    recovery: 'allow',
    orchestration: 'allow',
    worktree: 'allow',
  },
  plan: {
    'read-only': 'plan_only',
    write: 'plan_only',
    shell: 'plan_only',
    recovery: 'plan_only',
    orchestration: 'plan_only',
    worktree: 'plan_only',
  },
};

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
const { BLOCKED_DIRS } = safety;

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

function activeMode(ctx) {
  if (ctx.plan) return 'plan';
  if (ctx.acceptEdits && ctx.dontAsk) return 'acceptEditsAndDontAsk';
  if (ctx.dontAsk) return 'dontAsk';
  if (ctx.acceptEdits) return 'acceptEdits';
  return 'default';
}

function enrichDecision(base, extra = {}) {
  return {
    category: extra.category,
    mode: extra.mode,
    ruleId: extra.ruleId,
    matchedGuards: extra.matchedGuards || [],
    severity: extra.severity || 'bypassable_ask',
    explanation: extra.explanation || base.reason || 'Permission evaluated.',
    ...base,
  };
}

// Ext-8: full permission-decision cache. D2 cached just the realpath; this
// caches the entire decision keyed on (tool, canonical args, ctx flags) per
// session. Only allow/deny outcomes get cached — never `ask`, since the
// confirmation flow must always reach the user. Invalidation: any successful
// write through tool-registry drops cached entries for that path.
const _decisionCacheByCtx = new WeakMap();

function _getDecisionCache(ctx) {
  if (!ctx) return null;
  let m = _decisionCacheByCtx.get(ctx);
  if (!m) {
    m = new Map();
    _decisionCacheByCtx.set(ctx, m);
  }
  return m;
}

function _decisionKey(toolName, args, ctx) {
  const flags = (ctx.acceptEdits ? 'A' : '') + (ctx.dontAsk ? 'D' : '') + (ctx.allowShell ? 'S' : '');
  let argsKey;
  try {
    argsKey = JSON.stringify(args || {});
  } catch {
    argsKey = '<unserializable>';
  }
  return toolName + '|' + flags + '|' + argsKey;
}

function invalidateDecisionCache(ctx, paths) {
  if (!ctx) return;
  const cache = _decisionCacheByCtx.get(ctx);
  if (!cache) return;
  if (!paths || paths.length === 0) {
    cache.clear();
    return;
  }
  // Drop entries whose canonical args.path matches any invalidated path.
  for (const [k] of cache) {
    for (const p of paths) {
      if (k.includes('"path":"' + p + '"') || k.includes('"path":' + JSON.stringify(p))) {
        cache.delete(k);
        break;
      }
    }
  }
}

function check(toolName, args, ctx) {
  if (!ctx.cwdRealpath && ctx.cwd) {
    try {
      ctx.cwdRealpath = safety.cachedRealpathSync(ctx, ctx.cwd);
    } catch {
      ctx.cwdRealpath = ctx.cwd;
    }
  }

  const cache = _getDecisionCache(ctx);
  const cacheKey = cache ? _decisionKey(toolName, args, ctx) : null;
  if (cache && cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) {
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      return hit;
    }
  }

  const decision = _checkUncached(toolName, args, ctx);
  // Cache only stable outcomes: allow + hard_deny. `ask` decisions reach the
  // user via the confirmation flow each time and must not be memoized.
  if (cache && cacheKey && decision && decision.decision !== 'ask') {
    cache.set(cacheKey, decision);
    if (cache.size > 512) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return decision;
}

function _checkUncached(toolName, args, ctx) {
  const mode = activeMode(ctx);
  const category = CATEGORIES[toolName];
  const requestedPath = args && args.path;

  if (requestedPath) {
    const confined = safety.confinePath(ctx, requestedPath);
    if (!confined) {
      return enrichDecision(
        { decision: 'deny', reason: 'Path escapes working directory: ' + requestedPath },
        {
          category: category || 'unknown',
          mode,
          ruleId: 'path_guard',
          matchedGuards: ['path_confinement'],
          severity: 'hard_deny',
          explanation: 'That path is outside --cwd. The runner only accesses files inside the working directory.',
        },
      );
    }
    if (safety.isPathBlockedByDenyMatrix(confined)) {
      return enrichDecision(
        { decision: 'deny', reason: 'Blocked file type (potential secret): ' + path.basename(requestedPath) },
        {
          category: category || 'unknown',
          mode,
          ruleId: 'deny_matrix',
          matchedGuards: ['secret_pattern'],
          severity: 'hard_deny',
          explanation:
            'Sensitive files (.env, credentials, keys) are always blocked, even with --accept-edits or --chaos-ok.',
        },
      );
    }
  }

  if (toolName === 'bash' && args && args.command) {
    const { scanShellCommand } = require('./shell-policy');
    const scan = scanShellCommand(args.command, ctx);
    for (const issue of scan.issues) {
      if (issue.kind === 'hard_deny_path' || issue.kind === 'blocked_path_pattern') {
        return enrichDecision(
          {
            decision: 'deny',
            reason:
              issue.kind === 'hard_deny_path'
                ? 'Shell command references a blocked path pattern: ' + issue.segment
                : 'Shell command references a blocked path pattern: ' +
                  (issue.token || issue.segment || 'sensitive path'),
          },
          {
            category: 'shell',
            mode,
            ruleId: 'shell_hard_deny',
            matchedGuards: ['shell_scanner'],
            severity: 'hard_deny',
            explanation: 'Shell cannot touch protected files or directories like .env, .ssh, or credentials.',
          },
        );
      }
      if (issue.kind === 'blocked_env_var') {
        return enrichDecision(
          { decision: 'deny', reason: 'Shell command references a blocked environment variable' },
          {
            category: 'shell',
            mode,
            ruleId: 'shell_env_deny',
            matchedGuards: ['shell_scanner'],
            severity: 'hard_deny',
            explanation: 'Shell cannot read credential environment variables.',
          },
        );
      }
      if (issue.kind === 'network_command' && ctx.noNetwork) {
        return enrichDecision(
          { decision: 'deny', reason: 'Network command blocked under --no-network: ' + args.command.slice(0, 80) },
          {
            category: 'shell',
            mode,
            ruleId: 'no_network',
            matchedGuards: ['network_scanner'],
            severity: 'hard_deny',
            explanation: 'Network commands are blocked when --no-network is set.',
          },
        );
      }
    }
  }

  if (!category) {
    return enrichDecision(
      { decision: 'deny', reason: "Tool '" + toolName + "' is not in the allow-list." },
      { category: 'unknown', mode, ruleId: 'allowed_tools', severity: 'hard_deny', explanation: 'Unknown tool.' },
    );
  }

  if (toolName === 'spawn_agent' && (ctx.spawnDepth || 0) > 0) {
    return enrichDecision(
      { decision: 'deny', reason: 'Child agents cannot spawn further children.' },
      {
        category: 'orchestration',
        mode,
        ruleId: 'spawn_depth',
        severity: 'hard_deny',
        explanation: 'spawn_agent is only available in the top-level runner.',
      },
    );
  }

  if (category === 'shell' && !ctx.allowShell) {
    return enrichDecision(
      { decision: 'deny', reason: 'Shell commands are disabled. Use --allow-shell to enable.' },
      {
        category,
        mode,
        ruleId: 'shell_disabled',
        severity: 'bypassable_deny',
        explanation:
          'Shell is hidden by default. Add --allow-shell only when you accept unsandboxed local-account authority ' +
          '(commands start in --cwd but are not confined to it; --no-network is best-effort only).',
      },
    );
  }

  if (ctx.allowedTools && !ctx.allowedTools.has(toolName)) {
    return enrichDecision(
      { decision: 'deny', reason: "Tool '" + toolName + "' is not in the allowed-tools list." },
      {
        category,
        mode,
        ruleId: 'allowed_tools',
        severity: 'hard_deny',
        explanation: 'Tool not in --tools/--allowed-tools list.',
      },
    );
  }

  // P0-07: force-deleting a worktree + branch is irreversible enough that
  // --accept-edits / --dont-ask must never imply consent. Always ask with a
  // purpose-built description (path, branch, dirty state, recovery limits).
  if (toolName === 'exit_worktree' && args && args.cleanup) {
    const proposed = describeDestructiveWorktreeCleanup(args, ctx);
    return enrichDecision(
      {
        decision: 'ask',
        proposedAction: mode === 'plan' ? '(plan mode) ' + proposed : proposed,
      },
      {
        category,
        mode,
        ruleId: 'destructive_worktree_cleanup',
        severity: 'bypassable_ask',
        explanation:
          'Destructive worktree cleanup requires its own confirmation. ' +
          '--accept-edits only covers ordinary file edits, not branch deletion.',
      },
    );
  }

  const rule = MODES[mode];
  const decision = rule[category] || 'deny';

  if (decision === 'allow') {
    return enrichDecision(
      { decision: 'allow' },
      {
        category,
        mode,
        ruleId: 'mode_policy',
        severity: 'bypassable_ask',
        explanation: 'Allowed by current permission mode.',
      },
    );
  }

  if (decision === 'plan_only') {
    return enrichDecision(
      {
        decision: 'ask',
        proposedAction:
          '(plan mode) ' + (category === 'shell' ? describeShellAction(args) : describeWriteAction(toolName, args)),
      },
      { category, mode, ruleId: 'mode_policy', severity: 'bypassable_ask', explanation: 'Plan mode — dry run only.' },
    );
  }

  if (category === 'shell') {
    return enrichDecision(
      { decision: 'ask', proposedAction: describeShellAction(args) },
      {
        category,
        mode,
        ruleId: 'mode_policy',
        severity: 'bypassable_ask',
        explanation:
          'Shell commands require approval. Shell is unsandboxed local-account authority, not cwd confinement.',
      },
    );
  }

  return enrichDecision(
    { decision: 'ask', proposedAction: describeWriteAction(toolName, args) },
    {
      category,
      mode,
      ruleId: 'mode_policy',
      severity: 'bypassable_ask',
      explanation: 'Write tools require approval unless --accept-edits is set.',
    },
  );
}

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
  if (toolName === 'exit_worktree') {
    return args && args.cleanup
      ? describeDestructiveWorktreeCleanup(args, {})
      : 'Exit worktree slot (keep directory and branch)';
  }
  if (toolName === 'enter_worktree') {
    return 'Enter/create worktree slot "' + (args && args.slot ? args.slot : 'default') + '"';
  }
  return toolName + ' on ' + file;
}

/**
 * Purpose-built confirmation copy for exit_worktree cleanup=true.
 * Must never be replaced by a generic "write tool" sentence.
 */
function describeDestructiveWorktreeCleanup(args, ctx) {
  const slot = normalizeSlot((args && args.slot) || (ctx && ctx.activeWorktreeSlot));
  const wt = ctx && ctx.worktrees ? ctx.worktrees[slot] : null;
  const wtPath = wt && wt.path ? wt.path : '(unknown path — slot "' + slot + '" not registered in this run)';
  const branch = wt && wt.branch ? wt.branch : '(unknown branch)';
  const status = wt && wt.path ? inspectWorktreeStatus(wt.path) : { dirty: null, summary: 'status unavailable' };

  return (
    'DESTRUCTIVE worktree cleanup — explicit yes required:\n' +
    '  slot: ' +
    slot +
    '\n' +
    '  path: ' +
    wtPath +
    '\n' +
    '  branch: ' +
    branch +
    ' (will be force-deleted with git branch -D)\n' +
    '  git status: ' +
    status.summary +
    '\n' +
    '  actions: git worktree remove --force <path>; then git branch -D <branch>\n' +
    '  recovery: force-deleted branches and uncommitted worktree files are difficult or impossible to recover\n' +
    'This is NOT covered by --accept-edits. Approve only if you intend permanent deletion.'
  );
}

function describeShellAction(args) {
  const cmd = args.command || '(no command)';
  const shown = cmd.length > 100 ? cmd.slice(0, 97) + '...' : cmd;
  // Lead with the command, then the honesty line so Alan sees both before y/n.
  return 'Run: ' + shown + '\n[shell] ' + SHELL_AUTHORITY_SHORT;
}

/** Hard denies survive force execution. */
function isHardDeny(perm) {
  return perm && perm.severity === 'hard_deny';
}

module.exports = {
  check,
  isHardDeny,
  isInsideProject,
  isBlockedBasename,
  isBlockedDir,
  invalidateDecisionCache,
  CATEGORIES,
  MODES,
};
