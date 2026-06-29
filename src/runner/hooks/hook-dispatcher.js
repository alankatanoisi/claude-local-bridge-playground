'use strict';

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

class HookDispatcher {
  constructor(cwd, options = {}) {
    this.cwd = cwd;
    this.ctx = options.ctx || { cwd };
    this.config = loadHooksConfig(cwd);
    this.workspaceTrusted = options.workspaceTrusted ?? false;
    this.trusted = (options.trustedWorkspace ?? !!this.config.trusted) && this.workspaceTrusted;
    this.enabled = this.trusted && Array.isArray(this.config.hooks);
    this.log = [];
    this.lastLedgerEvent = null;
  }

  /** Record ledger event for hook-relative timing. */
  noteLedgerEvent(event) {
    this.lastLedgerEvent = event;
  }

  dispatch(event, payload = {}) {
    if (!HOOK_EVENTS.includes(event)) {
      return { skipped: true, reason: 'unknown_event' };
    }
    if (!this.workspaceTrusted) {
      return { skipped: true, reason: 'workspace_not_trusted' };
    }
    if (!this.enabled) {
      return { skipped: true, reason: this.trusted ? 'no_hooks' : 'untrusted_workspace' };
    }

    const matched = this.config.hooks.filter((h) => h.event === event);
    const results = [];
    for (const hook of matched) {
      const action = hook.action || 'log';
      const base = {
        name: hook.name || event,
        action,
        payload: { ...payload, event, afterLedger: this.lastLedgerEvent },
      };
      if (action === 'exec' || action === 'run') {
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
  HookDispatcher,
  loadHooksConfig,
  hooksConfigPath,
};
