'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveContextPolicy, DEFAULT_POLICY } = require('../../src/runner/context-policy');
const { buildSystem, buildRepoContextBlock } = require('../../src/runner/context-builder');
const { resolveSystemPrompt } = require('../../src/runner/system-prompt');
const { applyPermissionMode, normalizePermissionMode } = require('../../src/runner/permission-mode');

describe('context policy', () => {
  it('defaults to minimal with no doc or repo injection', () => {
    const policy = resolveContextPolicy({});
    assert.equal(policy.includeInstructionDocs, false);
    assert.equal(policy.includeRepoContext, false);
    assert.equal(policy.minimal, true);
  });

  it('--bare forces all rich context off', () => {
    const policy = resolveContextPolicy({
      bare: true,
      includeInstructionDocs: true,
      includeRepoContext: true,
    });
    assert.equal(policy.includeInstructionDocs, false);
    assert.equal(policy.includeRepoContext, false);
  });

  it('explicit context flags merge opt-ins', () => {
    const policy = resolveContextPolicy({
      includeInstructionDocs: true,
      includeRepoMap: true,
    });
    assert.equal(policy.includeInstructionDocs, true);
    assert.equal(policy.includeRepoMap, true);
    assert.equal(policy.minimal, false);
  });
});

describe('minimal system prompt', () => {
  it('does not mention local bridge runner by default', () => {
    const system = buildSystem({ cwd: process.cwd(), allowShell: false }, { contextPolicy: DEFAULT_POLICY });
    assert.match(system, /minimal coding agent/i);
    assert.doesNotMatch(system, /local bridge runner/i);
  });

  it('skips repo context block unless opted in', () => {
    const block = buildRepoContextBlock({ cwd: process.cwd() }, DEFAULT_POLICY);
    assert.equal(block, null);
  });
});

describe('system prompt assembly', () => {
  it('appends text after default build', () => {
    const priorHome = process.env.HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runner-empty-home-'));
    process.env.HOME = tmp;
    const ctx = { cwd: process.cwd(), allowShell: false };
    try {
      const system = resolveSystemPrompt(ctx, {
        contextPolicy: DEFAULT_POLICY,
        appendSystemPrompt: 'Extra lane rules.',
      });
      assert.match(system, /Extra lane rules/);
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses conventional SYSTEM.md and APPEND_SYSTEM.md files', () => {
    const priorHome = process.env.HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runner-system-'));
    const home = path.join(tmp, 'home');
    const cwd = path.join(tmp, 'project');
    fs.mkdirSync(path.join(home, '.bridge-runner'), { recursive: true });
    fs.mkdirSync(path.join(cwd, '.bridge-runner'), { recursive: true });
    fs.writeFileSync(path.join(home, '.bridge-runner', 'SYSTEM.md'), 'global system');
    fs.writeFileSync(path.join(home, '.bridge-runner', 'APPEND_SYSTEM.md'), 'global append');
    fs.writeFileSync(path.join(cwd, '.bridge-runner', 'SYSTEM.md'), 'project system');
    fs.writeFileSync(path.join(cwd, '.bridge-runner', 'APPEND_SYSTEM.md'), 'project append');
    process.env.HOME = home;
    try {
      const system = resolveSystemPrompt(
        { cwd, cwdRealpath: cwd, allowShell: false },
        { contextPolicy: DEFAULT_POLICY, appendSystemPrompt: 'cli append' },
      );
      assert.match(system, /^project system/);
      assert.match(system, /global append/);
      assert.match(system, /project append/);
      assert.match(system, /cli append/);
      assert.ok(system.indexOf('global append') < system.indexOf('project append'));
      assert.ok(system.indexOf('project append') < system.indexOf('cli append'));
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('permission mode', () => {
  it('normalizes plan mode', () => {
    assert.equal(normalizePermissionMode('plan'), 'plan');
    const merged = applyPermissionMode({}, 'plan');
    assert.equal(merged.plan, true);
    assert.equal(merged.acceptEdits, false);
  });
});
