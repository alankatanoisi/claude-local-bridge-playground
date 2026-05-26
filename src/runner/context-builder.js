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

function buildSystem(ctx, options = {}) {
  const allowShell = ctx && ctx.allowShell;
  const progressive = options.progressive !== false;

  let intro = 'You are a helpful coding assistant running inside a local bridge runner.\n';
  intro += 'You can read files and make precise edits to help the user.\n\n';

  const toolsSection = progressive ? buildToolSummarySection(ctx) : buildFullToolSection(allowShell);
  const rulesSection = buildRulesSection();

  let instructionText = '';
  let skillsListing = '';
  if (ctx && ctx.cwd) {
    const memory = ctx.instructionMemory || loadInstructionMemory(ctx.cwd);
    if (memory.text) instructionText = memory.text;
    if (isAutoMemoryEnabled(ctx)) {
      const autoSection = buildAutoMemorySection(ctx.cwd);
      if (autoSection) {
        instructionText = instructionText ? instructionText + '\n\n' + autoSection : autoSection;
      }
    }
    const skills = buildSkillsIndex(ctx.cwd);
    if (skills.listing) skillsListing = capSkillListing(skills.listing);
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
 * Build a session-stable "repository context" string. Computed once at session
 * start and prepended as its own cache_control block so it occupies the
 * fourth Anthropic cache breakpoint and lives the whole session.
 *
 * Returns null when no useful repo context is available (no cwd, no CLAUDE.md,
 * no git) so the caller falls back to the existing 3-breakpoint layout.
 */
function buildRepoContextBlock(ctx) {
  if (!ctx || !ctx.cwd) return null;
  const parts = [];
  let hasContent = false;

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

  const fpLines = [];
  fpLines.push('cwd: ' + (ctx.cwdRealpath || ctx.cwd));
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (head) {
      fpLines.push('git_head: ' + head);
      hasContent = true;
    }
  } catch {
    // not a git repo or git missing — fall through to cwd-only fingerprint
  }
  if (ctx.instructionHash) fpLines.push('instruction_hash: ' + ctx.instructionHash);
  parts.push('### Workspace fingerprint\n' + fpLines.join('\n'));

  // Ext-5: repo map at session start. One-pass scan, capped at ~2KB, lives
  // inside the same session-stable block so it rides the E1 cache breakpoint.
  try {
    const map = buildRepoMap(ctx.cwd);
    if (map) {
      parts.push(map);
      hasContent = true;
    }
  } catch {
    // best-effort; absence of repo map never blocks session start
  }

  if (!hasContent) return null;
  return '## Repository context (cached for the session)\n\n' + parts.join('\n\n');
}

function buildUserMessage(text, stdinText) {
  let content = text;
  if (stdinText) {
    content = text + '\n\n---\nPasted context:\n' + stdinText;
  }
  return { role: 'user', content };
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
};
