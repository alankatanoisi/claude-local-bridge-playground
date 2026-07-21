'use strict';

/**
 * Context budget — progressive disclosure and memoized system prompt cache.
 *
 * The cache is split into a static slice (compaction-independent) and a
 * dynamic tail (compaction-dependent). The dynamic tail is empty today but
 * the seam lets future commits inject per-turn hints without nuking the
 * whole prompt across compactionGeneration bumps.
 */

const crypto = require('crypto');
const { isToolVisible } = require('./tool-visibility');
const { CAPABILITY_GROUPS } = require('./tool-catalog');

const DEFAULT_CONTEXT_BUDGET_CHARS = 32_000;
const SKILL_ENTRY_MAX_CHARS = 250;
const SKILL_LISTING_BUDGET_FRACTION = 0.01;

let staticPromptCache = null;
let staticCacheKey = null;
let dynamicTailCache = null;
let dynamicCacheKey = null;

function _toolRegistryHash(ctx) {
  const allowShell = ctx && ctx.allowShell ? '1' : '0';
  const enableLsp = ctx && ctx.enableLsp ? '1' : '0';
  // P2-01: the capability set changes the offered surface, so it must change
  // the cache key — otherwise a 7-tool run could reuse a cached prompt that
  // still advertises an opted-in surface (or vice versa).
  const capabilities =
    ctx && ctx.enabledCapabilities instanceof Set ? [...ctx.enabledCapabilities].sort().join(',') : '';
  const allowed = ctx && ctx.allowedTools ? [...ctx.allowedTools].sort().join(',') : '*';
  const names = Object.keys(TOOL_SUMMARIES).sort().join(',');
  return crypto
    .createHash('sha1')
    .update(allowShell + '|' + enableLsp + '|' + capabilities + '|' + allowed + '|' + names)
    .digest('hex')
    .slice(0, 8);
}

function makeStaticKey(ctx) {
  return [ctx.cwdRealpath || ctx.cwd, ctx.instructionHash || '', ctx.trustState || '', _toolRegistryHash(ctx)].join(
    '|',
  );
}

function makeDynamicKey(ctx) {
  return [makeStaticKey(ctx), ctx.compactionGeneration || 0].join('||');
}

function invalidateContextCache() {
  staticPromptCache = null;
  staticCacheKey = null;
  dynamicTailCache = null;
  dynamicCacheKey = null;
}

function invalidateDynamicOnly() {
  dynamicTailCache = null;
  dynamicCacheKey = null;
}

function getCachedSystemPrompt(ctx) {
  const key = makeStaticKey(ctx);
  if (staticPromptCache && staticCacheKey === key) return staticPromptCache;
  return null;
}

function setCachedSystemPrompt(ctx, prompt) {
  staticCacheKey = makeStaticKey(ctx);
  staticPromptCache = prompt;
  return prompt;
}

function getCachedDynamicTail(ctx) {
  const key = makeDynamicKey(ctx);
  if (dynamicTailCache && dynamicCacheKey === key) return dynamicTailCache;
  return null;
}

function setCachedDynamicTail(ctx, tail) {
  dynamicCacheKey = makeDynamicKey(ctx);
  dynamicTailCache = tail;
  return tail;
}

/** One-line tool summaries for progressive disclosure (full schemas stay in API tools array). */
const TOOL_SUMMARIES = Object.freeze({
  list_files: 'List files and directories under a path',
  read_file: 'Read text, images (.png/.jpg/.gif/.webp), or PDF files by relative path',
  lsp_query: 'Language-server queries (definition, references, hover, diagnostics)',
  search_text: 'Search for text patterns in the project',
  glob: 'Find files by glob pattern (e.g. **/*.js)',
  manage_tasks: 'Update the in-session task checklist',
  ask_user_question: 'Structured multiple-choice clarification for the operator',
  list_worktrees: 'List active worktree slots and orphan worktree directories',
  run_skill: 'Load a skill document body by name (read-only)',
  manage_shell_jobs: 'Start/list/poll/kill background shell jobs',
  spawn_agent: 'Delegate a subtask to a child agent (isolated context)',
  enter_worktree: 'Create an isolated git worktree and switch into it',
  exit_worktree: 'Leave the active worktree and restore original cwd',
  git_status: 'Show git status (short format)',
  edit_file: 'Replace exact string in a file',
  write_file: 'Create or overwrite a file',
  apply_patch: 'Apply a unified diff patch',
  undo: 'List or restore from backups',
  undo_edit: 'Undo an edit from the current run',
  bash: 'Run a shell command (starts in --cwd; unsandboxed local-account authority, not cwd confinement)',
});

// Display labels for capability-group prompt lines. Keys must match
// CAPABILITY_GROUPS in tool-catalog.js (the lint below is the drift guard).
const GROUP_LABELS = Object.freeze({
  core: 'Core (read + session)',
  edits: 'Edits',
  recovery: 'Recovery',
  agents: 'Agents',
  worktrees: 'Worktrees',
  skills: 'Skills',
  lsp: 'LSP',
  shell: 'Shell',
});

/**
 * P2-02: capability prose is *generated* from the same isToolVisible() the
 * API tools array uses, so the prompt can never advertise a group or tool
 * that is not actually offered on this run (and never omits one that is).
 */
function buildToolSummarySection(ctx) {
  const lines = ['## Capability groups\n'];
  for (const [group, members] of Object.entries(CAPABILITY_GROUPS)) {
    const visible = members.filter((name) => isToolVisible(name, ctx));
    if (visible.length === 0) continue;
    lines.push('- ' + (GROUP_LABELS[group] || group) + ': ' + visible.join(', '));
  }
  lines.push('\n## Available tools (summaries)\n');
  for (const [name, summary] of Object.entries(TOOL_SUMMARIES)) {
    if (!isToolVisible(name, ctx)) continue;
    lines.push('- ' + name + ': ' + summary);
  }
  return lines.join('\n');
}

function budgetTruncate(text, maxChars, label) {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n... [budget truncated: ' + label + ']';
}

function capSkillListing(listing, totalBudgetChars) {
  if (!listing) return '';
  const cap = Math.max(500, Math.floor(totalBudgetChars * SKILL_LISTING_BUDGET_FRACTION));
  if (listing.length <= cap) return listing;
  const lines = listing.split('\n');
  let out = '';
  for (const line of lines) {
    const entry = line.slice(0, SKILL_ENTRY_MAX_CHARS);
    if (out.length + entry.length + 1 > cap) break;
    out += entry + '\n';
  }
  return out + '\n... [skills listing truncated]';
}

function applyContextBudget(sections, budgetChars = DEFAULT_CONTEXT_BUDGET_CHARS) {
  let remaining = budgetChars;
  const out = [];
  for (const { label, text } of sections) {
    if (!text) continue;
    const slice = budgetTruncate(text, remaining, label);
    out.push(slice);
    remaining -= slice.length;
    if (remaining <= 0) break;
  }
  return out.join('\n\n');
}

module.exports = {
  DEFAULT_CONTEXT_BUDGET_CHARS,
  SKILL_ENTRY_MAX_CHARS,
  invalidateContextCache,
  invalidateDynamicOnly,
  getCachedSystemPrompt,
  setCachedSystemPrompt,
  getCachedDynamicTail,
  setCachedDynamicTail,
  makeStaticKey,
  makeDynamicKey,
  buildToolSummarySection,
  capSkillListing,
  applyContextBudget,
  TOOL_SUMMARIES,
};
