'use strict';

/**
 * hook-dispatcher.js — Lifecycle hook dispatch with ONE explicit authority rule (P1-14).
 *
 * The single hook authority rule (identical in code, CLI help, threat model,
 * and command builder):
 *
 *   1. Workspace trust gate passed        (runtime `workspaceTrusted`)
 *   2. Operator opted in on the CLI       (`--trusted-workspace` flag)
 *   3. Exec/run hooks ADDITIONALLY need   `"trusted": true` (strict boolean)
 *      in `.bridge-runner/hooks.json`
 *
 * Log-only hooks run under conditions 1+2. Executable hooks require all three.
 * A matched exec hook whose config lacks `"trusted": true` is denied fail-closed
 * with a visible reason instead of silently running or silently vanishing.
 *
 * The effective decision is computed once at construction and exposed via
 * `describeAuthority()` so preflight/telemetry can report exactly why hooks
 * will or will not execute — no hidden boolean fallbacks.
 */

const fs = require('fs');
const path = require('path');
const { executeHookCommand } = require('./hook-runner');

const HOOK_EVENTS = Object.freeze([
  'session_start',
  'pre_model_request',
  'post_model_response',
  'pre_tool',
  'post_tool',
  'session_end',
]);

const HOOK_ACTIONS = Object.freeze(['log', 'exec', 'run']);
const EXEC_ACTIONS = Object.freeze(['exec', 'run']);

function hooksConfigPath(cwd) {
  return path.join(cwd, '.bridge-runner', 'hooks.json');
}

function loadHooksConfig(cwd) {
  const p = hooksConfigPath(cwd);
  if (!fs.existsSync(p)) return { trusted: false, hooks: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { trusted: false, hooks: [] };
  }
}

/**
 * Validate a raw hooks.json object into a normalized shape.
 * Invalid entries are dropped (never "best effort" executed) and each drop
 * records an index + reason so the operator can see what was rejected.
 */
function validateHooksConfig(raw) {
  const out = {
    // Strict boolean check: "trusted": "yes" or trusted: 1 must NOT authorize exec.
    configTrusted: raw && raw.trusted === true,
    hooks: [],
    invalid: [],
  };
  const list = raw && Array.isArray(raw.hooks) ? raw.hooks : [];
  list.forEach((hook, index) => {
    if (!hook || typeof hook !== 'object') {
      out.invalid.push({ index, reason: 'not_an_object' });
      return;
    }
    if (!HOOK_EVENTS.includes(hook.event)) {
      out.invalid.push({ index, reason: 'unknown_event', event: hook.event });
      return;
    }
    const action = hook.action || 'log';
    if (!HOOK_ACTIONS.includes(action)) {
      out.invalid.push({ index, reason: 'unknown_action', action });
      return;
    }
    if (EXEC_ACTIONS.includes(action) && (typeof hook.command !== 'string' || !hook.command.trim())) {
      out.invalid.push({ index, reason: 'exec_without_command' });
      return;
    }
    if (hook.timeout_ms !== undefined && !(Number(hook.timeout_ms) > 0)) {
      out.invalid.push({ index, reason: 'invalid_timeout_ms' });
      return;
    }
    out.hooks.push({ ...hook, action });
  });
  return out;
}

/**
 * Pure decision function for the single hook authority rule.
 * Kept separate from the dispatcher class so it is trivially testable and so
 * docs can point at one place for "the rule".
 */
function evaluateHookAuthority({ workspaceTrusted, hookOptIn, configTrusted, hookCount, execHookCount }) {
  const enabled = !!workspaceTrusted && !!hookOptIn && hookCount > 0;
  const execEnabled = enabled && configTrusted === true;
  let reason = 'enabled';
  if (!workspaceTrusted) reason = 'workspace_not_trusted';
  else if (!hookOptIn) reason = 'hooks_not_opted_in';
  else if (hookCount === 0) reason = 'no_hooks';
  else if (execHookCount > 0 && !execEnabled) reason = 'exec_requires_config_trusted';
  return { enabled, execEnabled, reason };
}

class HookDispatcher {
  constructor(cwd, options = {}) {
    this.cwd = cwd;
    this.ctx = options.ctx || { cwd };
    const validated = validateHooksConfig(loadHooksConfig(cwd));
    this.hooks = validated.hooks;
    this.invalidHooks = validated.invalid;
    this.configTrusted = validated.configTrusted;
    this.workspaceTrusted = options.workspaceTrusted ?? false;
    // Opt-in comes ONLY from the explicit CLI flag plumbed through run options.
    // There is deliberately no fallback to config content here (P1-14): config
    // may narrow exec authority via "trusted", never grant dispatch by itself.
    this.hookOptIn = !!(options.hookOptIn ?? options.trustedWorkspace);
    const execHookCount = this.hooks.filter((h) => EXEC_ACTIONS.includes(h.action)).length;
    this.authority = {
      workspaceTrusted: !!this.workspaceTrusted,
      hookOptIn: this.hookOptIn,
      configTrusted: this.configTrusted,
      hookCount: this.hooks.length,
      execHookCount,
      invalidHookCount: this.invalidHooks.length,
      ...evaluateHookAuthority({
        workspaceTrusted: this.workspaceTrusted,
        hookOptIn: this.hookOptIn,
        configTrusted: this.configTrusted,
        hookCount: this.hooks.length,
        execHookCount,
      }),
    };
    // Back-compat fields some callers/tests read.
    this.trusted = this.authority.enabled;
    this.enabled = this.authority.enabled;
    this.log = [];
    this.lastLedgerEvent = null;
  }

  /** Effective, explainable hook decision for preflight/telemetry surfaces. */
  describeAuthority() {
    return { ...this.authority, invalidHooks: [...this.invalidHooks] };
  }

  /** Record ledger event for hook-relative timing. */
  noteLedgerEvent(event) {
    this.lastLedgerEvent = event;
  }

  dispatch(event, payload = {}) {
    if (!HOOK_EVENTS.includes(event)) {
      return { skipped: true, reason: 'unknown_event' };
    }
    if (!this.authority.enabled) {
      // Preserve the historical reason string for the untrusted-workspace case
      // so existing consumers/tests keep working.
      const reason =
        this.authority.reason === 'workspace_not_trusted'
          ? 'workspace_not_trusted'
          : this.authority.reason === 'hooks_not_opted_in'
            ? 'untrusted_workspace'
            : 'no_hooks';
      return { skipped: true, reason };
    }

    const matched = this.hooks.filter((h) => h.event === event);
    const results = [];
    for (const hook of matched) {
      const action = hook.action || 'log';
      const base = {
        name: hook.name || event,
        action,
        payload: { ...payload, event, afterLedger: this.lastLedgerEvent },
      };
      if (EXEC_ACTIONS.includes(action)) {
        if (!this.authority.execEnabled) {
          // Fail closed AND visible: the hook is recorded as denied rather
          // than silently skipped or (worse) executed under a weaker rule.
          results.push({
            ...base,
            exec: {
              ok: false,
              denied: true,
              action,
              error: 'Exec hook denied: .bridge-runner/hooks.json must set "trusted": true (strict boolean).',
            },
          });
          continue;
        }
        const execResult = executeHookCommand(hook, this.ctx, payload);
        results.push({ ...base, exec: execResult });
      } else {
        results.push(base);
      }
    }
    this.log.push({ event, ts: new Date().toISOString(), results, afterLedger: this.lastLedgerEvent });
    return { skipped: false, results };
  }

  getLog() {
    return [...this.log];
  }
}

module.exports = {
  HOOK_EVENTS,
  HOOK_ACTIONS,
  HookDispatcher,
  loadHooksConfig,
  validateHooksConfig,
  evaluateHookAuthority,
  hooksConfigPath,
};
