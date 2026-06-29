'use strict';

// Interface tests for the tool catalog (src/runner/tool-catalog.js).
// The catalog is the single source of truth for the runner's tool set: each
// tool module declares its own meta, and the catalog derives every map the
// rest of the runner reads. These tests assert the derivation and the
// load-time self-check that keeps a half-registered tool from passing silently.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../src/runner/tool-catalog');

describe('tool catalog — derived maps', () => {
  it('exposes exactly the known tool set in stable (model-facing) order', () => {
    assert.deepEqual(Object.keys(catalog.TOOLS), [
      'list_files',
      'read_file',
      'search_text',
      'glob',
      'manage_tasks',
      'ask_user_question',
      'spawn_agent',
      'enter_worktree',
      'list_worktrees',
      'exit_worktree',
      'manage_shell_jobs',
      'run_skill',
      'git_status',
      'lsp_query',
      'edit_file',
      'write_file',
      'apply_patch',
      'undo',
      'undo_edit',
      'bash',
    ]);
  });

  it('derives CATEGORIES from each tool meta', () => {
    assert.deepEqual(catalog.CATEGORIES, {
      list_files: 'read-only',
      read_file: 'read-only',
      search_text: 'read-only',
      glob: 'read-only',
      manage_tasks: 'read-only',
      ask_user_question: 'read-only',
      spawn_agent: 'orchestration',
      enter_worktree: 'worktree',
      list_worktrees: 'read-only',
      exit_worktree: 'worktree',
      manage_shell_jobs: 'shell',
      run_skill: 'read-only',
      git_status: 'read-only',
      lsp_query: 'read-only',
      edit_file: 'write',
      write_file: 'write',
      apply_patch: 'write',
      undo: 'recovery',
      undo_edit: 'recovery',
      bash: 'shell',
    });
  });

  it('derives WRITE_TOOLS from category === write', () => {
    assert.deepEqual([...catalog.WRITE_TOOLS].sort(), ['apply_patch', 'edit_file', 'write_file']);
  });

  it('derives DEFAULT_HIDDEN_TOOLS from meta.hidden', () => {
    assert.deepEqual([...catalog.DEFAULT_HIDDEN_TOOLS], ['apply_patch']);
  });

  it('every category is one of the six valid kinds', () => {
    for (const [name, category] of Object.entries(catalog.CATEGORIES)) {
      assert.ok(catalog.VALID_CATEGORIES.has(category), name + ' has a valid category');
    }
  });
});

describe('tool catalog — each tool self-describes consistently', () => {
  it('every real tool module has meta and meta.name === definition().name', () => {
    for (const mod of catalog.TOOL_MODULES) {
      assert.ok(mod.meta, 'module exports meta');
      assert.equal(typeof mod.meta.name, 'string');
      assert.equal(mod.meta.name, mod.definition().name, 'meta.name agrees with definition().name');
      assert.equal(typeof mod.execute, 'function');
    }
  });
});

describe('tool catalog — self-check (buildCatalog rejects bad modules)', () => {
  const goodTool = {
    meta: { name: 'good_tool', category: 'read-only' },
    definition: () => ({ name: 'good_tool' }),
    execute: () => ({ ok: true }),
  };

  it('accepts a well-formed module', () => {
    const built = catalog.buildCatalog([goodTool]);
    assert.equal(built.CATEGORIES.good_tool, 'read-only');
  });

  it('throws when meta is missing', () => {
    assert.throws(
      () => catalog.buildCatalog([{ definition: () => ({ name: 'x' }), execute: () => {} }]),
      /missing meta.name/,
    );
  });

  it('throws on an invalid category', () => {
    assert.throws(
      () =>
        catalog.buildCatalog([
          { meta: { name: 'x', category: 'bogus' }, definition: () => ({ name: 'x' }), execute: () => {} },
        ]),
      /invalid meta.category/,
    );
  });

  it('throws when meta.name disagrees with definition().name', () => {
    assert.throws(
      () =>
        catalog.buildCatalog([
          { meta: { name: 'x', category: 'write' }, definition: () => ({ name: 'y' }), execute: () => {} },
        ]),
      /disagrees with definition\(\).name/,
    );
  });

  it('throws on a duplicate tool name', () => {
    assert.throws(() => catalog.buildCatalog([goodTool, goodTool]), /duplicate tool name/);
  });

  it('throws when definition/execute are missing', () => {
    assert.throws(
      () => catalog.buildCatalog([{ meta: { name: 'x', category: 'write' } }]),
      /must export definition\(\) and execute\(\)/,
    );
  });
});

describe('tool catalog — no require cycle', () => {
  it('catalog, permissions, registry, pipeline, and compactor all load', () => {
    assert.doesNotThrow(() => {
      require('../../src/runner/tool-catalog');
      require('../../src/runner/permissions');
      require('../../src/runner/tool-registry');
      require('../../src/runner/tool-pipeline');
      require('../../src/runner/context-compactor');
    });
  });
});
