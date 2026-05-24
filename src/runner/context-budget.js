'use strict';

/**
 * Context budget — progressive disclosure and memoized system prompt cache.
 */

const DEFAULT_CONTEXT_BUDGET_CHARS = 32_000;
const SKILL_ENTRY_MAX_CHARS = 250;
const SKILL_LISTING_BUDGET_FRACTION = 0.01;

let systemPromptCache = null;
let cacheKey = null;

function makeCacheKey(ctx) {
  return [
    ctx.cwdRealpath || ctx.cwd,
    !!ctx.allowShell,
    ctx.allowedTools ? [...ctx.allowedTools].sort().join(',') : '*',
    ctx.instructionHash || '',
    ctx.compactionGeneration || 0,
    ctx.trustState || '',
  ].join('|');
}

function invalidateContextCache() {
  systemPromptCache = null;
  cacheKey = null;
}

function getCachedSystemPrompt(ctx) {
  const key = makeCacheKey(ctx);
  if (systemPromptCache && cacheKey === key) return systemPromptCache;
  return null;
}

function setCachedSystemPrompt(ctx, prompt) {
  cacheKey = makeCacheKey(ctx);
  systemPromptCache = prompt;
  return prompt;
}

/** One-line tool summaries for progressive disclosure (full schemas stay in API tools array). */
const TOOL_SUMMARIES = Object.freeze({
  list_files: 'List files and directories under a path',
  read_file: 'Read file contents by relative path',
  search_text: 'Search for text patterns in the project',
  git_status: 'Show git status (short format)',
  edit_file: 'Replace exact string in a file',
  write_file: 'Create or overwrite a file',
  apply_patch: 'Apply a unified diff patch',
  undo: 'List or restore from backups',
  undo_edit: 'Undo an edit from the current run',
  bash: 'Run a shell command in the project directory',
  describe_tools: 'Load full tool documentation for a category',
});

function buildToolSummarySection(ctx) {
  const lines = ['## Available tools (summaries)\n'];
  for (const [name, summary] of Object.entries(TOOL_SUMMARIES)) {
    if (name === 'bash' && !(ctx && ctx.allowShell)) continue;
    if (name === 'describe_tools') continue;
    if (ctx && ctx.allowedTools && !ctx.allowedTools.has(name)) continue;
    lines.push('- ' + name + ': ' + summary);
  }
  lines.push('\nUse describe_tools to load full documentation for read, write, or shell categories.');
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
  getCachedSystemPrompt,
  setCachedSystemPrompt,
  buildToolSummarySection,
  capSkillListing,
  applyContextBudget,
  TOOL_SUMMARIES,
};
