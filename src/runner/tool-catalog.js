'use strict';

/**
 * tool-catalog.js — Single source of truth for the runner's tool set.
 *
 * Each tool module under ./tools declares its own facts:
 *
 *   module.exports = { definition, execute, meta: { name, category, hidden? } };
 *
 * where `category` is one of 'read-only' | 'write' | 'shell' | 'recovery'.
 *
 * This module requires the tool modules once and derives every map the rest of
 * the runner needs — TOOLS, CATEGORIES, WRITE_TOOLS, DEFAULT_HIDDEN_TOOLS — so
 * adding or reclassifying a tool is a one-place change inside the tool module
 * instead of edits spread across permissions, tool-registry, and the compactor.
 *
 * The catalog requires *only* the tool modules (which depend on safety + utils,
 * never on permissions), so the dependency graph stays acyclic:
 *   permissions / tool-registry / tool-pipeline / context-compactor
 *     → tool-catalog → tools → safety
 */

const VALID_CATEGORIES = new Set(['read-only', 'write', 'shell', 'recovery', 'orchestration', 'worktree']);

// Insertion order is the order tools are offered to the model — preserved from
// the historical TOOLS map so the tools array (and its prompt cache) is stable.
const TOOL_MODULES = [
  require('./tools/list-files'),
  require('./tools/read-file'),
  require('./tools/search-text'),
  require('./tools/glob'),
  require('./tools/manage-tasks'),
  require('./tools/ask-user-question'),
  require('./tools/spawn-agent'),
  require('./tools/enter-worktree'),
  require('./tools/list-worktrees'),
  require('./tools/exit-worktree'),
  require('./tools/manage-shell-jobs'),
  require('./tools/run-skill'),
  require('./tools/git-status'),
  require('./tools/lsp-query'),
  require('./tools/edit-file'),
  require('./tools/write-file'),
  require('./tools/apply-patch'),
  require('./tools/undo'),
  require('./tools/undo-edit'),
  require('./tools/bash'),
];

// Derive the maps from a list of tool modules. The self-check makes a
// half-registered tool fail loudly here, not silently at runtime (a missing
// category would otherwise break both permission classification and the
// pipeline's read/write batching). Exported so the validation is itself
// testable with stub modules.
function buildCatalog(modules) {
  const TOOLS = {};
  const CATEGORIES = {};
  const WRITE_TOOLS = new Set();
  const DEFAULT_HIDDEN_TOOLS = new Set();
  const QUARANTINED_TOOLS = new Set();

  for (const mod of modules) {
    const meta = mod && mod.meta;
    if (!meta || typeof meta.name !== 'string' || !meta.name) {
      throw new Error('tool-catalog: a tool module is missing meta.name');
    }
    if (!VALID_CATEGORIES.has(meta.category)) {
      throw new Error('tool-catalog: tool "' + meta.name + '" has invalid meta.category: ' + meta.category);
    }
    if (typeof mod.definition !== 'function' || typeof mod.execute !== 'function') {
      throw new Error('tool-catalog: tool "' + meta.name + '" must export definition() and execute()');
    }
    const definedName = mod.definition().name;
    if (definedName !== meta.name) {
      throw new Error(
        'tool-catalog: tool "' + meta.name + '" meta.name disagrees with definition().name "' + definedName + '"',
      );
    }
    if (TOOLS[meta.name]) {
      throw new Error('tool-catalog: duplicate tool name "' + meta.name + '"');
    }
    TOOLS[meta.name] = mod;
    CATEGORIES[meta.name] = meta.category;
    if (meta.category === 'write') WRITE_TOOLS.add(meta.name);
    if (meta.hidden) DEFAULT_HIDDEN_TOOLS.add(meta.name);
    if (meta.quarantined) QUARANTINED_TOOLS.add(meta.name);
  }

  return { TOOLS, CATEGORIES, WRITE_TOOLS, DEFAULT_HIDDEN_TOOLS, QUARANTINED_TOOLS };
}

const { TOOLS, CATEGORIES, WRITE_TOOLS, DEFAULT_HIDDEN_TOOLS, QUARANTINED_TOOLS } = buildCatalog(TOOL_MODULES);

/**
 * P2-01 (2026-07-20): capability groups — the runner's opt-in surface.
 *
 * `core` is the only group offered on a no-flag run (the "small core" from
 * AGENTS.md). Every other group must be switched on explicitly:
 *
 *   - edits / recovery / agents / worktrees / skills / lsp → `--capabilities`
 *   - lsp is also enabled by the older `--enable-lsp` flag
 *   - shell → `--allow-shell` ONLY (never via --capabilities; the scary
 *     consent flag must stay singular)
 *   - apply_patch belongs to `edits` but stays hidden-by-default; only an
 *     exact `--tools apply_patch` allowlist exposes it
 *
 * Insertion order here is the order group lines appear in the system prompt.
 * The self-check below fails loudly if a tool is missing from the map or
 * listed twice, so adding a tool without picking its group breaks the build
 * instead of silently widening the default surface.
 */
const CAPABILITY_GROUPS = Object.freeze({
  core: Object.freeze([
    'list_files',
    'read_file',
    'search_text',
    'glob',
    'git_status',
    'manage_tasks',
    'ask_user_question',
  ]),
  edits: Object.freeze(['edit_file', 'write_file', 'apply_patch']),
  recovery: Object.freeze(['undo', 'undo_edit']),
  agents: Object.freeze(['spawn_agent']),
  worktrees: Object.freeze(['enter_worktree', 'exit_worktree', 'list_worktrees']),
  skills: Object.freeze(['run_skill']),
  lsp: Object.freeze(['lsp_query']),
  shell: Object.freeze(['bash', 'manage_shell_jobs']),
});

// Reverse map: tool name → group name, with exactly-one-group validation.
function buildGroupIndex(groups, tools) {
  const TOOL_GROUPS = {};
  for (const [group, names] of Object.entries(groups)) {
    for (const name of names) {
      if (!tools[name]) {
        throw new Error('tool-catalog: capability group "' + group + '" names unknown tool "' + name + '"');
      }
      if (TOOL_GROUPS[name]) {
        throw new Error(
          'tool-catalog: tool "' + name + '" is in two capability groups: ' + TOOL_GROUPS[name] + ', ' + group,
        );
      }
      TOOL_GROUPS[name] = group;
    }
  }
  for (const name of Object.keys(tools)) {
    if (!TOOL_GROUPS[name]) {
      throw new Error('tool-catalog: tool "' + name + '" is not assigned to any capability group');
    }
  }
  return TOOL_GROUPS;
}

const TOOL_GROUPS = buildGroupIndex(CAPABILITY_GROUPS, TOOLS);

// Groups a user may name in --capabilities. `core` is always on (naming it is
// harmless but pointless); `shell` is deliberately excluded — see above.
const OPTIONAL_CAPABILITIES = Object.freeze(['edits', 'recovery', 'agents', 'worktrees', 'skills', 'lsp']);

module.exports = {
  TOOLS,
  CATEGORIES,
  WRITE_TOOLS,
  DEFAULT_HIDDEN_TOOLS,
  QUARANTINED_TOOLS,
  VALID_CATEGORIES,
  buildCatalog,
  TOOL_MODULES,
  CAPABILITY_GROUPS,
  TOOL_GROUPS,
  OPTIONAL_CAPABILITIES,
  buildGroupIndex,
};
