'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getProfile, applyProfileToRunOptions, assertForkAllowed } = require('../../src/runner/agents/registry');

describe('agent profiles', () => {
  it('explore profile is read-only', () => {
    const p = getProfile('explore');
    assert.ok(p);
    assert.ok(p.allowedTools.every((t) => ['list_files', 'read_file', 'search_text', 'git_status'].includes(t)));
    assert.equal(p.forkAllowed, false);
  });

  it('applyProfileToRunOptions sets allowedTools and maxSteps', () => {
    const applied = applyProfileToRunOptions('plan', { maxSteps: 99 });
    assert.equal(applied.plan, true);
    assert.equal(applied.maxSteps, 10);
    assert.ok(applied.allowedTools.includes('read_file'));
  });

  it('bench profile exposes realistic dev-task tools but preserves explicit shell/edit opt-ins', () => {
    const applied = applyProfileToRunOptions('bench', {});
    assert.equal(applied.maxSteps, 40);
    assert.ok(applied.allowedTools.includes('bash'));
    assert.ok(applied.allowedTools.includes('apply_patch'));
    assert.equal(applied.allowShell, undefined);
    assert.equal(applied.acceptEdits, undefined);
  });
});

describe('fork boundary', () => {
  it('blocks spawn depth > 0', () => {
    assert.doesNotThrow(() => assertForkAllowed(0));
    assert.throws(() => assertForkAllowed(1), /cannot spawn further children/i);
  });
});
