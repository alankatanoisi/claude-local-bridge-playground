'use strict';

/**
 * P1-14 — Hook execution trust: one explicit authority rule.
 *
 * Contract under test:
 *   - hooks dispatch at all only with workspace trust + CLI opt-in
 *   - exec/run hooks ADDITIONALLY require strict `"trusted": true` in hooks.json
 *   - config "trusted" can never grant dispatch by itself (no boolean fallback)
 *   - malformed hook entries are dropped with recorded reasons
 *   - the effective decision is exposed via describeAuthority()
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  HookDispatcher,
  validateHooksConfig,
  evaluateHookAuthority,
} = require('../../src/runner/hooks/hook-dispatcher');

function makeWorkspace(config) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-14-hooks-'));
  fs.mkdirSync(path.join(tmp, '.bridge-runner'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.bridge-runner', 'hooks.json'), JSON.stringify(config), 'utf8');
  return tmp;
}

const EXEC_HOOK = { event: 'post_tool', name: 'echo', action: 'exec', command: 'echo p1_14_ok' };
const LOG_HOOK = { event: 'post_tool', name: 'note', action: 'log' };

describe('P1-14 hook authority rule', () => {
  it('exec hooks run only when workspace trust + CLI opt-in + config trusted:true all hold', () => {
    const tmp = makeWorkspace({ trusted: true, hooks: [EXEC_HOOK] });
    const hooks = new HookDispatcher(tmp, {
      hookOptIn: true,
      workspaceTrusted: true,
      ctx: { cwd: tmp, cwdRealpath: tmp },
    });
    const auth = hooks.describeAuthority();
    assert.equal(auth.enabled, true);
    assert.equal(auth.execEnabled, true);
    const r = hooks.dispatch('post_tool', { tool: 'edit_file' });
    assert.equal(r.skipped, false);
    assert.equal(r.results[0].exec.ok, true);
    assert.match(r.results[0].exec.output, /p1_14_ok/);
  });

  it('exec hooks are DENIED (fail closed, visible) when hooks.json lacks trusted:true', () => {
    const tmp = makeWorkspace({ hooks: [EXEC_HOOK] });
    const hooks = new HookDispatcher(tmp, {
      hookOptIn: true,
      workspaceTrusted: true,
      ctx: { cwd: tmp, cwdRealpath: tmp },
    });
    const auth = hooks.describeAuthority();
    assert.equal(auth.enabled, true, 'dispatch itself stays on (log hooks may run)');
    assert.equal(auth.execEnabled, false);
    assert.equal(auth.reason, 'exec_requires_config_trusted');
    const r = hooks.dispatch('post_tool', { tool: 'edit_file' });
    assert.equal(r.skipped, false);
    assert.equal(r.results[0].exec.denied, true);
    assert.equal(r.results[0].exec.ok, false);
    assert.match(r.results[0].exec.error, /"trusted": true/);
  });

  it('truthy-but-not-boolean trusted values do NOT authorize exec', () => {
    for (const trusted of ['true', 'yes', 1, {}, []]) {
      const tmp = makeWorkspace({ trusted, hooks: [EXEC_HOOK] });
      const hooks = new HookDispatcher(tmp, {
        hookOptIn: true,
        workspaceTrusted: true,
        ctx: { cwd: tmp, cwdRealpath: tmp },
      });
      assert.equal(hooks.describeAuthority().execEnabled, false, 'trusted=' + JSON.stringify(trusted));
      const r = hooks.dispatch('post_tool', {});
      assert.equal(r.results[0].exec.denied, true);
    }
  });

  it('config trusted:true can never grant dispatch without the CLI opt-in', () => {
    const tmp = makeWorkspace({ trusted: true, hooks: [EXEC_HOOK] });
    const hooks = new HookDispatcher(tmp, {
      hookOptIn: false,
      workspaceTrusted: true,
      ctx: { cwd: tmp, cwdRealpath: tmp },
    });
    const auth = hooks.describeAuthority();
    assert.equal(auth.enabled, false);
    assert.equal(auth.reason, 'hooks_not_opted_in');
    const r = hooks.dispatch('post_tool', {});
    assert.equal(r.skipped, true);
  });

  it('nothing dispatches without workspace trust regardless of opt-in and config', () => {
    const tmp = makeWorkspace({ trusted: true, hooks: [EXEC_HOOK, LOG_HOOK] });
    const hooks = new HookDispatcher(tmp, {
      hookOptIn: true,
      workspaceTrusted: false,
      ctx: { cwd: tmp, cwdRealpath: tmp },
    });
    assert.equal(hooks.describeAuthority().enabled, false);
    const r = hooks.dispatch('post_tool', {});
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'workspace_not_trusted');
  });

  it('log-only hooks run under trust + opt-in even without config trusted:true', () => {
    const tmp = makeWorkspace({ hooks: [LOG_HOOK] });
    const hooks = new HookDispatcher(tmp, {
      hookOptIn: true,
      workspaceTrusted: true,
      ctx: { cwd: tmp, cwdRealpath: tmp },
    });
    const r = hooks.dispatch('post_tool', { tool: 'read_file' });
    assert.equal(r.skipped, false);
    assert.equal(r.results[0].action, 'log');
    assert.equal(r.results[0].exec, undefined);
  });

  it('validateHooksConfig drops malformed entries with recorded reasons', () => {
    const v = validateHooksConfig({
      trusted: true,
      hooks: [
        EXEC_HOOK,
        null,
        { event: 'no_such_event', action: 'log' },
        { event: 'post_tool', action: 'launch_missiles' },
        { event: 'post_tool', action: 'exec' }, // exec without command
        { event: 'post_tool', action: 'exec', command: 'echo x', timeout_ms: -5 },
      ],
    });
    assert.equal(v.hooks.length, 1);
    assert.equal(v.invalid.length, 5);
    assert.deepEqual(
      v.invalid.map((i) => i.reason),
      ['not_an_object', 'unknown_event', 'unknown_action', 'exec_without_command', 'invalid_timeout_ms'],
    );
  });

  it('evaluateHookAuthority is a pure statement of the rule', () => {
    // Full three-way grant.
    assert.deepEqual(
      evaluateHookAuthority({
        workspaceTrusted: true,
        hookOptIn: true,
        configTrusted: true,
        hookCount: 2,
        execHookCount: 1,
      }),
      { enabled: true, execEnabled: true, reason: 'enabled' },
    );
    // Missing any leg disables exec.
    for (const leg of ['workspaceTrusted', 'hookOptIn', 'configTrusted']) {
      const input = { workspaceTrusted: true, hookOptIn: true, configTrusted: true, hookCount: 1, execHookCount: 1 };
      input[leg] = false;
      assert.equal(evaluateHookAuthority(input).execEnabled, false, 'leg=' + leg);
    }
  });
});
