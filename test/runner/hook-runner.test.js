'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { HookDispatcher } = require('../../src/runner/hooks/hook-dispatcher');
const { executeHookCommand } = require('../../src/runner/hooks/hook-runner');

describe('executable hooks', () => {
  it('executeHookCommand runs allowlisted shell and scrubs output', () => {
    const ctx = { cwd: os.tmpdir(), cwdRealpath: os.tmpdir() };
    const result = executeHookCommand({ action: 'exec', command: 'echo hook_ok' }, ctx, { event: 'post_tool' });
    assert.equal(result.ok, true);
    assert.match(result.output, /hook_ok/);
  });

  it('blocks hook commands that fail shell policy', () => {
    const ctx = { cwd: os.tmpdir(), cwdRealpath: os.tmpdir() };
    const result = executeHookCommand({ action: 'exec', command: 'cat .env' }, ctx, {});
    assert.equal(result.ok, false);
    assert.match(result.error, /blocked/i);
  });

  it('HookDispatcher runs exec hooks when workspace is trusted', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-exec-'));
    fs.mkdirSync(path.join(tmp, '.bridge-runner'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.bridge-runner', 'hooks.json'),
      JSON.stringify({
        trusted: true,
        hooks: [{ event: 'post_tool', name: 'verify-echo', action: 'exec', command: 'echo post_tool_hook' }],
      }),
      'utf8',
    );
    const hooks = new HookDispatcher(tmp, {
      trustedWorkspace: true,
      workspaceTrusted: true,
      ctx: { cwd: tmp, cwdRealpath: tmp },
    });
    const r = hooks.dispatch('post_tool', { tool: 'edit_file', ok: true });
    assert.equal(r.skipped, false);
    assert.equal(r.results[0].exec.ok, true);
    assert.match(r.results[0].exec.output, /post_tool_hook/);
  });
});
