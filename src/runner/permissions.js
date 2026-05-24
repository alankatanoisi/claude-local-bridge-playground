'use strict';

/**
 * permissions.js — Category-based safety gate with severity levels and explainer metadata.
 */

const path = require('path');
const safety = require('./safety');

const CATEGORIES = {
  list_files: 'read-only',
  read_file: 'read-only',
  search_text: 'read-only',
  git_status: 'read-only',
  edit_file: 'write',
  write_file: 'write',
  apply_patch: 'write',
  undo: 'recovery',
  undo_edit: 'recovery',
  bash: 'shell',
};

const MODES = {
  default: { 'read-only': 'allow', write: 'ask', shell: 'ask', recovery: 'allow' },
  acceptEdits: { 'read-only': 'allow', write: 'allow', shell: 'ask', recovery: 'allow' },
  dontAsk: { 'read-only': 'allow', write: 'ask', shell: 'allow', recovery: 'allow' },
  acceptEditsAndDontAsk: { 'read-only': 'allow', write: 'allow', shell: 'allow', recovery: 'allow' },
  plan: {
    'read-only': 'plan_only',
    write: 'plan_only',
    shell: 'plan_only',
    recovery: 'plan_only',
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

function check(toolName, args, ctx) {
  if (!ctx.cwdRealpath && ctx.cwd) {
    try {
      const fs = require('fs');
      ctx.cwdRealpath = fs.realpathSync(ctx.cwd);
    } catch {
      ctx.cwdRealpath = ctx.cwd;
    }
  }

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
                : 'Shell command references a blocked path pattern: ' + (issue.token || issue.segment || 'sensitive path'),
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

  if (category === 'shell' && !ctx.allowShell) {
    return enrichDecision(
      { decision: 'deny', reason: 'Shell commands are disabled. Use --allow-shell to enable.' },
      {
        category,
        mode,
        ruleId: 'shell_disabled',
        severity: 'bypassable_deny',
        explanation: 'Shell is hidden by default. Add --allow-shell when you need terminal commands.',
      },
    );
  }

  if (ctx.allowedTools && !ctx.allowedTools.has(toolName)) {
    return enrichDecision(
      { decision: 'deny', reason: "Tool '" + toolName + "' is not in the allowed-tools list." },
      { category, mode, ruleId: 'allowed_tools', severity: 'hard_deny', explanation: 'Tool not in --allowed-tools list.' },
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
      { category, mode, ruleId: 'mode_policy', severity: 'bypassable_ask', explanation: 'Shell commands require approval.' },
    );
  }

  return enrichDecision(
    { decision: 'ask', proposedAction: describeWriteAction(toolName, args) },
    { category, mode, ruleId: 'mode_policy', severity: 'bypassable_ask', explanation: 'Write tools require approval unless --accept-edits is set.' },
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
  return toolName + ' on ' + file;
}

function describeShellAction(args) {
  const cmd = args.command || '(no command)';
  return 'Run: ' + (cmd.length > 100 ? cmd.slice(0, 97) + '...' : cmd);
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
  BLOCKED_DIRS,
  CATEGORIES,
  MODES,
};
