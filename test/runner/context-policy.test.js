'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveContextPolicy, DEFAULT_POLICY } = require('../../src/runner/context-policy');
const { buildSystem, buildRepoContextBlock } = require('../../src/runner/context-builder');
const { resolveSystemPrompt } = require('../../src/runner/system-prompt');
const { applyProfileToRunOptions } = require('../../src/runner/agents/registry');
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

  it('profile context merges opt-ins', () => {
    const policy = resolveContextPolicy({
      profileContext: { includeInstructionDocs: true, includeRepoMap: true },
    });
    assert.equal(policy.includeInstructionDocs, true);
    assert.equal(policy.includeRepoMap, true);
    assert.equal(policy.minimal, false);
  });
});

describe('minimal system prompt', () => {
  it('does not mention local bridge runner by default', () => {
    const system = buildSystem({ cwd: process.cwd(), allowShell: false }, { contextPolicy: DEFAULT_POLICY });
    assert.match(system, /coding assistant/i);
    assert.doesNotMatch(system, /local bridge runner/i);
  });

  it('skips repo context block unless opted in', () => {
    const block = buildRepoContextBlock({ cwd: process.cwd() }, DEFAULT_POLICY);
    assert.equal(block, null);
  });
});

describe('system prompt assembly', () => {
  it('appends text after default build', () => {
    const ctx = { cwd: process.cwd(), allowShell: false };
    const system = resolveSystemPrompt(ctx, {
      contextPolicy: DEFAULT_POLICY,
      appendSystemPrompt: 'Extra lane rules.',
    });
    assert.match(system, /Extra lane rules/);
  });
});

describe('runner personalities', () => {
  it('project profile enables richer context defaults', () => {
    const opts = applyProfileToRunOptions('project', {});
    const policy = resolveContextPolicy(opts);
    assert.equal(policy.includeInstructionDocs, true);
    assert.equal(policy.includeRepoMap, true);
  });

  it('implement profile sets accept-edits permission mode', () => {
    const opts = applyProfileToRunOptions('implement', {});
    assert.equal(opts.acceptEdits, true);
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
