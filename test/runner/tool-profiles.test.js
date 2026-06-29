'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  BUILTIN_PROFILES,
  loadToolProfile,
  computeAllowedTools,
  isToolVisible,
  checkProfileConstraints,
  listToolProfiles,
} = require('../../src/runner/tool-profiles');
const { getDefinitions } = require('../../src/runner/tool-registry');
const permissions = require('../../src/runner/permissions');

describe('tool capability profiles', () => {
  it('lists built-in profiles', () => {
    const rows = listToolProfiles('/tmp');
    assert.ok(rows.some((row) => row.id === 'review-only'));
    assert.ok(rows.some((row) => row.id === 'git-readonly-shell'));
  });

  it('review-only hides write and shell tools even with acceptEdits', () => {
    const ctx = {
      allowShell: true,
      acceptEdits: true,
      spawnDepth: 0,
      toolProfile: BUILTIN_PROFILES['review-only'],
      _cliToolAllowlist: null,
    };
    ctx.allowedTools = computeAllowedTools(ctx);
    const names = getDefinitions(ctx).map((tool) => tool.name);
    assert.ok(names.includes('read_file'));
    assert.ok(!names.includes('edit_file'));
    assert.ok(!names.includes('bash'));
  });

  it('edit-source-no-shell allows writes but not bash', () => {
    const ctx = {
      allowShell: true,
      acceptEdits: true,
      spawnDepth: 0,
      toolProfile: BUILTIN_PROFILES['edit-source-no-shell'],
      _cliToolAllowlist: null,
    };
    ctx.allowedTools = computeAllowedTools(ctx);
    const names = getDefinitions(ctx).map((tool) => tool.name);
    assert.ok(names.includes('edit_file'));
    assert.ok(!names.includes('bash'));
    assert.ok(!names.includes('apply_patch'));
  });

  it('git-readonly-shell enforces bash command regex at permission time', () => {
    const ctx = {
      allowShell: true,
      acceptEdits: false,
      spawnDepth: 0,
      cwd: '/tmp',
      toolProfile: BUILTIN_PROFILES['git-readonly-shell'],
      _cliToolAllowlist: null,
    };
    ctx.allowedTools = computeAllowedTools(ctx);

    const allowed = permissions.check('bash', { command: 'git status' }, ctx);
    assert.equal(allowed.decision, 'ask');

    const denied = permissions.check('bash', { command: 'curl https://example.com' }, ctx);
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.ruleId, 'tool_profile_constraint');
  });

  it('loads project profile JSON from .bridge-runner/profiles/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-profile-'));
    const profileDir = path.join(tmp, '.bridge-runner', 'profiles');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(
      path.join(profileDir, 'custom-read.json'),
      JSON.stringify({
        id: 'custom-read',
        title: 'Custom read',
        rationale: 'Only read_file',
        tools: {
          read_file: 'allow',
          list_files: 'deny',
        },
      }),
      'utf8',
    );

    const profile = loadToolProfile('custom-read', { cwd: tmp });
    assert.equal(profile.id, 'custom-read');
    const ctx = {
      allowShell: false,
      spawnDepth: 0,
      toolProfile: profile,
      _cliToolAllowlist: null,
    };
    ctx.allowedTools = computeAllowedTools(ctx);
    assert.ok(isToolVisible('read_file', ctx));
    assert.ok(!isToolVisible('list_files', ctx));
  });

  it('intersects profile exposure with --tools allowlist', () => {
    const ctx = {
      allowShell: false,
      spawnDepth: 0,
      toolProfile: BUILTIN_PROFILES['review-only'],
      _cliToolAllowlist: new Set(['read_file', 'edit_file']),
    };
    ctx.allowedTools = computeAllowedTools(ctx);
    const names = [...ctx.allowedTools];
    assert.deepEqual(names, ['read_file']);
  });

  it('write_file max_bytes constraint denies oversized content', () => {
    const reason = checkProfileConstraints(
      'write_file',
      { path: 'x.txt', content: 'x'.repeat(20) },
      {
        id: 'tiny-writes',
        constraints: { write_file: { max_bytes: 10 } },
      },
    );
    assert.ok(reason.includes('max_bytes'));
  });
});
