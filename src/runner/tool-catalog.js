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
  }

  return { TOOLS, CATEGORIES, WRITE_TOOLS, DEFAULT_HIDDEN_TOOLS };
}

const { TOOLS, CATEGORIES, WRITE_TOOLS, DEFAULT_HIDDEN_TOOLS } = buildCatalog(TOOL_MODULES);

module.exports = { TOOLS, CATEGORIES, WRITE_TOOLS, DEFAULT_HIDDEN_TOOLS, VALID_CATEGORIES, buildCatalog, TOOL_MODULES };
