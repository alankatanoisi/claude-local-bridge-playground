'use strict';

/**
 * context-builder.js — Builds the message payload for the Anthropic API.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadInstructionMemory } = require('./memory/instruction-memory');
const { buildAutoMemorySection, isAutoMemoryEnabled } = require('./memory/auto-memory');
const { buildSkillsIndex } = require('./skills/skills-index');
const { buildToolSummarySection, capSkillListing, applyContextBudget } = require('./context-budget');
const { buildRepoMap } = require('./repo-map');
const { DEFAULT_POLICY } = require('./context-policy');

function buildFullToolSection(allowShell) {
  let prompt = '## Available tools\n\n';
  prompt += '- list_files: List files and directories under a relative path.\n';
  prompt += '- read_file: Read the contents of a file by relative path.\n';
  prompt += '- search_text: Search for a text pattern inside the project (case-insensitive).\n';
  prompt += '- git_status: Show the current git status (short format).\n';
  prompt += '- edit_file: Replace old_string with new_string in a file. The old_string must match exactly once.\n';
  prompt += '- write_file: Create or overwrite a file with full content. A backup is saved.\n';
  prompt += '- apply_patch: Apply a unified diff patch to a file. A backup is saved.\n';
  prompt +=
    '- undo: List available backups or restore a file from a previous backup. Use this to recover from mistakes.\n';
  prompt += '- undo_edit: Undo an edit_file or write_file call from the current run by tool_use_id or path.\n';
  if (allowShell) {
    prompt += '- bash: Run a shell command inside the project directory (timeout + output limits apply).\n';
  }
  return prompt;
}

function buildRulesSection() {
  let prompt = '## Rules\n\n';
  prompt += '1. You may only use the tools listed above.\n';
  prompt += '2. You may only access paths inside the working directory.\n';
  prompt +=
    '3. When editing a file, use the exact text from the file for old_string. Copy it precisely including indentation.\n';
  prompt += '4. If old_string matches multiple times, include more surrounding lines to make it unique.\n';
  prompt += '5. After making edits, consider running validation (lint, tests) using bash if available.\n';
  prompt += '6. If a validation step fails, read the error and try to fix the issue.\n';
  prompt += '7. Never suggest editing .env files, credentials, private keys, or git config.\n';
  prompt += '8. If you have enough information to answer without making changes, return a FINAL answer.\n';
  prompt +=
    '9. Read-only tools (list_files, read_file, search_text, git_status) may be batched by the runner for speed. Write and shell tools are always executed one at a time with confirmation.\n';
  return prompt;
}

function resolveContextPolicy(options = {}) {
  return options.contextPolicy || DEFAULT_POLICY;
}

function buildSystem(ctx, options = {}) {
  const allowShell = ctx && ctx.allowShell;
  const progressive = options.progressive !== false;
  const policy = resolveContextPolicy(options);

  let intro = 'You are a capable coding assistant helping with software tasks in the user project folder.\n';
  intro += 'Use tools when needed; answer directly when no tools are required.\n\n';

  const toolsSection = progressive ? buildToolSummarySection(ctx) : buildFullToolSection(allowShell);
  const rulesSection = buildRulesSection();

  let instructionText = '';
  let skillsListing = '';
  if (ctx && ctx.cwd) {
    if (policy.includeInstructionDocs) {
      const memory =
        ctx.instructionMemory || loadInstructionMemory(ctx.cwdRealpath || ctx.cwd, { includeProjectDocs: true });
      if (memory.text) instructionText = memory.text;
    }
    if (isAutoMemoryEnabled(ctx)) {
      const autoSection = buildAutoMemorySection(ctx.cwd);
      if (autoSection) {
        instructionText = instructionText ? instructionText + '\n\n' + autoSection : autoSection;
      }
    }
    if (policy.includeSkills) {
      const skills = buildSkillsIndex(ctx.cwd);
      if (skills.listing) skillsListing = capSkillListing(skills.listing);
    }
  }

  return applyContextBudget([
    { label: 'intro', text: intro },
    { label: 'tools', text: toolsSection },
    { label: 'rules', text: rulesSection },
    { label: 'instructions', text: instructionText },
    { label: 'skills', text: skillsListing },
  ]);
}

/**
 * Dynamic per-machine context (cwd, git, instruction hash). When
 * excludeDynamicFromSystem is set, callers move this to the first user message.
 */
function buildDynamicEnvironmentBlock(ctx) {
  if (!ctx || !ctx.cwd) return null;
  const fpLines = [];
  fpLines.push('cwd: ' + (ctx.cwdRealpath || ctx.cwd));
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (head) fpLines.push('git_head: ' + head);
  } catch {
    // not a git repo
  }
  if (ctx.instructionHash) fpLines.push('instruction_hash: ' + ctx.instructionHash);
  return '## Environment\n\n' + fpLines.join('\n');
}

/**
 * Session-stable repository context (optional). No project markdown is injected unless
 * includeClaudeMdInRepoContext is set; repo map requires includeRepoMap.
 */
function buildRepoContextBlock(ctx, contextPolicy = DEFAULT_POLICY) {
  if (!ctx || !ctx.cwd || !contextPolicy.includeRepoContext) return null;
  const parts = [];
  let hasContent = false;

  if (contextPolicy.includeClaudeMdInRepoContext) {
    try {
      const claudePath = path.join(ctx.cwd, 'CLAUDE.md');
      if (fs.existsSync(claudePath)) {
        const content = fs.readFileSync(claudePath, 'utf8');
        parts.push('### CLAUDE.md\n' + content.trim());
        hasContent = true;
      }
    } catch {
      // ignore unreadable CLAUDE.md
    }
  }

  if (!contextPolicy.excludeDynamicFromSystem) {
    const dynamic = buildDynamicEnvironmentBlock(ctx);
    if (dynamic) {
      parts.push('### Workspace fingerprint\n' + dynamic.replace('## Environment\n\n', ''));
      hasContent = true;
    }
  }

  if (contextPolicy.includeRepoMap) {
    try {
      const map = buildRepoMap(ctx.cwd);
      if (map) {
        parts.push(map);
        hasContent = true;
      }
    } catch {
      // best-effort
    }
  }

  if (!hasContent) return null;
  return '## Repository context (cached for the session)\n\n' + parts.join('\n\n');
}

function buildUserMessage(text, stdinText, prefixBlocks) {
  const blocks = [];
  if (prefixBlocks && prefixBlocks.length) {
    for (const block of prefixBlocks) {
      if (block) blocks.push({ type: 'text', text: block });
    }
  }
  let content = text;
  if (stdinText) {
    content = text + '\n\n---\nPasted context:\n' + stdinText;
  }
  blocks.push({ type: 'text', text: content });
  return { role: 'user', content: blocks.length === 1 ? content : blocks };
}

function buildToolResultMessage(toolUseId, resultText) {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: resultText,
      },
    ],
  };
}

module.exports = {
  buildSystem,
  buildUserMessage,
  buildToolResultMessage,
  buildFullToolSection,
  buildRepoContextBlock,
  buildDynamicEnvironmentBlock,
};
