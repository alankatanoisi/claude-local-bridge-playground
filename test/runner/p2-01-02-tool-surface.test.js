'use strict';

/**
 * P2-01 / P2-02 acceptance tests (2026-07-20).
 *
 * P2-01 — default tool surface is the seven-tool safe core; everything else
 *   is an explicit opt-in (--capabilities, --allow-shell, --enable-lsp,
 *   --tools).
 * P2-02 — the system prompt's capability prose is generated from the same
 *   visibility function as the API tools array, so every named tool is
 *   offered and every offered tool is named (both directions).
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { getDefinitions } = require('../../src/runner/tool-registry');
const { isToolVisible, normalizeCapabilityList, computeAllowedTools } = require('../../src/runner/tool-visibility');
const { CAPABILITY_GROUPS, TOOL_GROUPS, TOOLS } = require('../../src/runner/tool-catalog');
const { buildToolSummarySection } = require('../../src/runner/context-budget');
const { buildFullToolSection } = require('../../src/runner/context-builder');

const CORE_SEVEN = [
  'list_files',
  'read_file',
  'search_text',
  'glob',
  'git_status',
  'manage_tasks',
  'ask_user_question',
];

function offeredNames(ctx) {
  return getDefinitions(ctx)
    .map((d) => d.name)
    .sort();
}

test('P2-01: catalog capability groups', async (t) => {
  await t.test('every tool belongs to exactly one group (validated at load)', () => {
    for (const name of Object.keys(TOOLS)) {
      assert.ok(TOOL_GROUPS[name], name + ' has a capability group');
    }
    const flattened = Object.values(CAPABILITY_GROUPS).flat();
    assert.strictEqual(flattened.length, Object.keys(TOOLS).length, 'groups cover the catalog with no duplicates');
  });

  await t.test('the core group is exactly the seven-tool safe core', () => {
    assert.deepStrictEqual([...CAPABILITY_GROUPS.core].sort(), [...CORE_SEVEN].sort());
  });
});

test('P2-01: default and opted-in tool surfaces', async (t) => {
  await t.test('no-flag startup offers exactly the seven core tools', () => {
    assert.deepStrictEqual(offeredNames({}), [...CORE_SEVEN].sort());
  });

  await t.test('--capabilities edits adds edit_file and write_file but not hidden apply_patch', () => {
    const ctx = { enabledCapabilities: new Set(['edits']) };
    const names = offeredNames(ctx);
    assert.ok(names.includes('edit_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(!names.includes('apply_patch'), 'apply_patch stays hidden-by-default even with edits enabled');
    assert.ok(!names.includes('undo'), 'recovery is a separate opt-in');
  });

  await t.test('recovery, agents, worktrees, skills each opt in independently', () => {
    const expectations = [
      ['recovery', ['undo', 'undo_edit']],
      ['agents', ['spawn_agent']],
      ['worktrees', ['enter_worktree', 'exit_worktree', 'list_worktrees']],
      ['skills', ['run_skill']],
    ];
    for (const [group, tools] of expectations) {
      const names = offeredNames({ enabledCapabilities: new Set([group]) });
      for (const tool of tools) {
        assert.ok(names.includes(tool), group + ' enables ' + tool);
      }
      assert.deepStrictEqual(names, [...CORE_SEVEN, ...tools].sort(), group + ' adds only its own tools');
    }
  });

  await t.test('shell tools require allowShell, never a capability name', () => {
    assert.ok(!offeredNames({}).includes('bash'));
    const names = offeredNames({ allowShell: true });
    assert.ok(names.includes('bash'));
    assert.ok(names.includes('manage_shell_jobs'));
    assert.throws(() => normalizeCapabilityList('shell'), /--allow-shell/);
  });

  await t.test('lsp_query rides --enable-lsp or the lsp capability', () => {
    assert.ok(!offeredNames({}).includes('lsp_query'));
    assert.ok(offeredNames({ enableLsp: true }).includes('lsp_query'));
    assert.ok(offeredNames({ enabledCapabilities: new Set(['lsp']) }).includes('lsp_query'));
  });

  await t.test('spawn_agent stays hidden at depth > 0 even when agents is enabled', () => {
    const ctx = { enabledCapabilities: new Set(['agents']), spawnDepth: 1 };
    assert.ok(!offeredNames(ctx).includes('spawn_agent'));
  });

  await t.test('--tools exact allowlist still works and still honors hard gates', () => {
    const ctx = { _cliToolAllowlist: new Set(['read_file', 'apply_patch', 'bash']) };
    ctx.allowedTools = computeAllowedTools(ctx);
    const names = offeredNames(ctx);
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('apply_patch'), '--tools may expose hidden apply_patch');
    assert.ok(!names.includes('bash'), '--tools bash without --allow-shell stays hidden');
    assert.ok(!names.includes('list_files'), '--tools is exact: unlisted tools are hidden');
  });

  await t.test('normalizeCapabilityList validates names and accepts set/array/string', () => {
    assert.deepStrictEqual([...normalizeCapabilityList('edits, recovery')].sort(), ['edits', 'recovery']);
    assert.deepStrictEqual([...normalizeCapabilityList(['agents'])], ['agents']);
    assert.deepStrictEqual([...normalizeCapabilityList(new Set(['skills']))], ['skills']);
    assert.deepStrictEqual([...normalizeCapabilityList('core')], [], 'core is accepted but always on');
    assert.throws(() => normalizeCapabilityList('everything'), /unknown capability/);
  });
});

// P2-02 acceptance criterion: every named capability in the system prompt has
// a matching offered definition and vice versa.
function assertPromptMatchesOffer(ctx, label) {
  const offered = new Set(getDefinitions(ctx).map((d) => d.name));
  const section = buildToolSummarySection(ctx);

  // Every catalog tool name that appears in the prompt must be offered.
  for (const name of Object.keys(TOOLS)) {
    const mentioned = new RegExp('(^|[^a-z_])' + name + '([^a-z_]|$)', 'm').test(section);
    if (mentioned) {
      assert.ok(offered.has(name), label + ': prompt mentions "' + name + '" but it is not offered');
    }
  }
  // Every offered tool must appear in the prompt summaries.
  for (const name of offered) {
    assert.ok(section.includes(name), label + ': offered tool "' + name + '" missing from prompt');
  }
}

test('P2-02: capability prose matches the offered definition set', async (t) => {
  const shapes = [
    ['default', {}],
    ['edits', { enabledCapabilities: new Set(['edits']) }],
    ['edits+recovery', { enabledCapabilities: new Set(['edits', 'recovery']) }],
    ['agents+worktrees', { enabledCapabilities: new Set(['agents', 'worktrees']) }],
    ['shell', { allowShell: true }],
    ['lsp', { enableLsp: true }],
    [
      'tools allowlist',
      (() => {
        const ctx = { _cliToolAllowlist: new Set(['read_file', 'edit_file']) };
        ctx.allowedTools = computeAllowedTools(ctx);
        return ctx;
      })(),
    ],
    [
      'everything',
      (() => {
        const ctx = {
          allowShell: true,
          enableLsp: true,
          enabledCapabilities: new Set(['edits', 'recovery', 'agents', 'worktrees', 'skills']),
        };
        return ctx;
      })(),
    ],
  ];

  for (const [label, ctx] of shapes) {
    await t.test('prompt ↔ offer concordance: ' + label, () => {
      assertPromptMatchesOffer(ctx, label);
    });
  }

  await t.test('default prompt advertises no write/agent/worktree/recovery/shell groups', () => {
    const section = buildToolSummarySection({});
    for (const absent of ['Edits', 'Recovery', 'Agents', 'Worktrees', 'Shell', 'edit_file', 'bash', 'spawn_agent']) {
      assert.ok(!section.includes(absent), 'default prompt must not mention ' + absent);
    }
  });

  await t.test('full (non-progressive) tool section is also visibility-filtered', () => {
    const dflt = buildFullToolSection({});
    assert.ok(dflt.includes('read_file'));
    assert.ok(!dflt.includes('edit_file'));
    assert.ok(!dflt.includes('bash'));
    const edits = buildFullToolSection({ enabledCapabilities: new Set(['edits']) });
    assert.ok(edits.includes('edit_file'));
    assert.ok(!edits.includes('apply_patch'));
  });

  await t.test('visibility function and prompt agree tool-by-tool across the catalog', () => {
    const ctx = { enabledCapabilities: new Set(['edits', 'skills']) };
    const section = buildToolSummarySection(ctx);
    for (const name of Object.keys(TOOLS)) {
      assert.strictEqual(
        section.includes('- ' + name + ':') || new RegExp('(^|[ ,])' + name + '(,|$)', 'm').test(section),
        isToolVisible(name, ctx),
        'prompt/visibility disagree on ' + name,
      );
    }
  });
});
