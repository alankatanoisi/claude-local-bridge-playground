'use strict';

/**
 * Beginner-friendly error hints — plain-language explanations for runtime errors.
 * Every error path should map to { whatHappened, why, tip, docLink }.
 */

const HINT_CATALOG = Object.freeze({
  ECONNREFUSED: {
    whatHappened: 'The runner could not connect to the local bridge server.',
    why: 'The bridge runs as a VS Code extension and must be started before the runner.',
    tip: 'Open VS Code, make sure Claude Local Bridge is installed and running, then try again.',
    docLink: 'docs/runner-quickstart.html#troubleshooting',
  },
  UNAUTHORIZED_401: {
    whatHappened: 'The bridge rejected the request because credentials are missing or expired.',
    why: 'The runner uses credentials from VS Code via the local bridge.',
    tip: 'Re-authenticate in VS Code (look for the Claude icon in the status bar), then retry.',
    docLink: 'docs/runner-quickstart.html#troubleshooting',
  },
  RATE_LIMIT_429: {
    whatHappened: 'The API rate-limited this request.',
    why: 'Too many requests were sent in a short time.',
    tip: 'The runner will wait and retry automatically. If this keeps happening, wait a few minutes.',
    docLink: null,
  },
  BRIDGE_TIMEOUT: {
    whatHappened: 'The bridge took too long to respond.',
    why: 'Large requests or a slow connection can cause timeouts.',
    tip: 'Try again, or use a smaller --max-tokens value.',
    docLink: null,
  },
  PERMISSION_PATH_GUARD: {
    whatHappened: 'The runner blocked access because the file is outside the working directory.',
    why: 'The runner only touches files inside --cwd for safety.',
    tip: 'Check that your --cwd path is correct and the file path is relative to it.',
    docLink: 'docs/threat-model.md',
  },
  PERMISSION_DENY_MATRIX: {
    whatHappened: 'The runner blocked access to a sensitive file (.env, .ssh, credentials, etc.).',
    why: 'These files often contain secrets and are protected even with --accept-edits.',
    tip: 'Edit this file manually outside the runner if you truly need to change it.',
    docLink: 'docs/threat-model.md',
  },
  PERMISSION_SHELL_DISABLED: {
    whatHappened: 'The runner blocked a shell command.',
    why: 'Shell access is hidden by default for safety.',
    tip: 'Add --allow-shell only when you need to run terminal commands, then approve each command.',
    docLink: null,
  },
  workspace_not_trusted: {
    whatHappened: "This folder hasn't been approved yet.",
    why: 'The runner needs your permission before it can read or change files here.',
    tip: "Type 'y' when prompted, or run with --trust-workspace next time.",
    docLink: 'docs/runner-quickstart.html',
  },
  max_steps: {
    whatHappened: 'The runner hit its step limit without finishing.',
    why: 'Each step is one model turn (thinking + tool calls). The default limit is 16.',
    tip: 'Increase with --max-steps or ask a more focused question.',
    docLink: null,
  },
  context_budget_exceeded: {
    whatHappened: 'The conversation used too many tokens.',
    why: 'Long conversations cost more and can hit model limits.',
    tip: 'Try a shorter prompt, or use --session-id to start a fresh session.',
    docLink: null,
  },
  semantic_cycle_detected: {
    whatHappened: 'The model is repeating the same actions.',
    why: 'This usually means the agent is stuck in a loop.',
    tip: 'Try rephrasing your request or breaking it into smaller steps.',
    docLink: null,
  },
  compaction_applied: {
    whatHappened: 'Older messages were compressed to save space.',
    why: 'Long conversations need compression to stay within context limits.',
    tip: 'The model can re-read files if it needs the details again. This is normal.',
    docLink: null,
  },
  ledger_crash_recovery: {
    whatHappened: 'The last run did not finish cleanly.',
    why: 'A crash or interruption left some steps incomplete in the session ledger.',
    tip: 'The runner recovered what it could. Check the human log for details.',
    docLink: null,
  },
  resume_failed: {
    whatHappened: 'Could not resume the previous session.',
    why: 'No valid ledger or session checkpoint was found for this session.',
    tip: 'Start a new session with --session-id, or check that the session path exists.',
    docLink: null,
  },
  bridge_error: {
    whatHappened: 'Something went wrong talking to the bridge.',
    why: 'Network, auth, or server errors can interrupt a run.',
    tip: 'Check that VS Code and the bridge extension are running, then retry.',
    docLink: 'docs/runner-quickstart.html#troubleshooting',
  },
  tool_failure_escalation: {
    whatHappened: 'The runner stopped because tools kept failing.',
    why: 'Repeated failures usually mean the agent is stuck retrying the same broken action.',
    tip: 'Read the last tool error, fix the underlying issue, and start a new run.',
    docLink: null,
  },
  user_denied: {
    whatHappened: 'You declined a tool action.',
    why: 'Write and shell tools ask for confirmation unless --accept-edits is set.',
    tip: 'Re-run and approve the action, or use --accept-edits if you want fewer prompts.',
    docLink: null,
  },
  fork_depth_exceeded: {
    whatHappened: 'A child agent tried to spawn another child agent.',
    why: 'Only one level of subagents is allowed to keep runs predictable.',
    tip: 'Use the parent agent to coordinate; child agents cannot fork further.',
    docLink: null,
  },
  resume_degraded: {
    whatHappened: 'This session ended in a bad state last time (loop, budget, or tool failures).',
    why: 'Resuming poisoned sessions often wastes tokens and repeats the same mistakes.',
    tip: 'Start fresh with --new-session, or pass --ack-resume-risk only if you accept the risk.',
    docLink: 'docs/runner-quickstart.html',
  },
  fresh_session_recommended: {
    whatHappened: 'The last run finished in a state where a fresh session is safer.',
    why: 'Long or unstable sessions accumulate bad context and compaction debt.',
    tip: 'Use --new-session for the next task, or --fork-from to branch without losing history.',
    docLink: 'docs/runner-quickstart.html',
  },
});

/** Match raw error text to a catalog key. */
function matchErrorKey(rawMessage, stopReason) {
  if (stopReason && HINT_CATALOG[stopReason]) return stopReason;
  const msg = String(rawMessage || '');
  if (/ECONNREFUSED/i.test(msg)) return 'ECONNREFUSED';
  if (/401|Unauthorized/i.test(msg)) return 'UNAUTHORIZED_401';
  if (/429|Too Many Requests/i.test(msg)) return 'RATE_LIMIT_429';
  if (/timeout|ETIMEDOUT/i.test(msg)) return 'BRIDGE_TIMEOUT';
  if (/Path escapes working directory/i.test(msg)) return 'PERMISSION_PATH_GUARD';
  if (/Blocked file type|blocked path pattern/i.test(msg)) return 'PERMISSION_DENY_MATRIX';
  if (/Shell commands are disabled/i.test(msg)) return 'PERMISSION_SHELL_DISABLED';
  if (/workspace_not_trusted|not been approved/i.test(msg)) return 'workspace_not_trusted';
  if (/max_steps|Reached max_steps/i.test(msg)) return 'max_steps';
  if (/Context token budget exceeded/i.test(msg)) return 'context_budget_exceeded';
  if (/consecutive tool failures/i.test(msg)) return 'tool_failure_escalation';
  if (/User denied/i.test(msg)) return 'user_denied';
  if (/cannot spawn further children|fork depth/i.test(msg)) return 'fork_depth_exceeded';
  if (/Could not resume/i.test(msg)) return 'resume_failed';
  if (/Session health is degraded/i.test(msg)) return 'resume_degraded';
  if (/Bridge error/i.test(msg)) return 'bridge_error';
  return null;
}

/**
 * @param {string} errorKey — catalog key or matched from message
 * @param {object} [context] — { verbose, quiet, rawMessage, ... }
 * @returns {{ whatHappened: string, why?: string, tip: string, docLink?: string|null, formatted: string, hint?: object }}
 */
function formatHint(errorKey, context = {}) {
  const { verbose = false, quiet = false, rawMessage = '' } = context;
  const key = errorKey || matchErrorKey(rawMessage);
  const entry = key ? HINT_CATALOG[key] : null;

  if (!entry) {
    const fallback = {
      whatHappened: rawMessage || 'An unexpected error occurred.',
      tip: 'Check stderr output and the human log for more details.',
      formatted: rawMessage || 'An unexpected error occurred.',
    };
    return fallback;
  }

  const hint = {
    whatHappened: entry.whatHappened,
    why: entry.why,
    tip: entry.tip,
    docLink: entry.docLink,
  };

  if (quiet) {
    return { ...hint, formatted: rawMessage || entry.whatHappened };
  }

  const lines = ['What happened: ' + entry.whatHappened, 'Tip: ' + entry.tip];
  if (verbose && entry.why) lines.splice(1, 0, 'Why: ' + entry.why);
  if (verbose && entry.docLink) lines.push('See: ' + entry.docLink);

  return { ...hint, formatted: lines.join('\n') };
}

/** Print hint to stderr unless quiet. */
function emitHint(rawMessage, options = {}) {
  const { quiet = false, verbose = false, stopReason } = options;
  if (quiet) {
    console.error(rawMessage);
    return null;
  }
  const key = stopReason || matchErrorKey(rawMessage);
  const hint = formatHint(key, { verbose, quiet, rawMessage });
  console.error('[runner] ' + (rawMessage || hint.whatHappened));
  console.error('[runner hint] ' + hint.formatted);
  return hint;
}

module.exports = {
  HINT_CATALOG,
  matchErrorKey,
  formatHint,
  emitHint,
};
