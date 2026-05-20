'use strict';

/**
 * context-builder.js — Builds the message payload for the Anthropic API.
 *
 * Constructs:
 *   - system prompt (instructions + tool descriptions)
 *   - messages array (user/assistant/tool_result exchanges)
 *
 * The system prompt is built dynamically based on context flags
 * (e.g. whether bash is enabled).
 */

function buildSystem(ctx) {
  const allowShell = ctx && ctx.allowShell;
  let prompt = 'You are a helpful coding assistant running inside a local bridge runner.\n';
  prompt += 'You can read files and make precise edits to help the user.\n\n';
  prompt += '## Available tools\n\n';
  prompt += '- list_files: List files and directories under a relative path.\n';
  prompt += '- read_file: Read the contents of a file by relative path.\n';
  prompt += '- search_text: Search for a text pattern inside the project (case-insensitive).\n';
  prompt += '- git_status: Show the current git status (short format).\n';
  prompt += '- edit_file: Replace old_string with new_string in a file. The old_string must match exactly once.\n';
  prompt += '- write_file: Create or overwrite a file with full content. A backup is saved.\n';
  prompt += '- apply_patch: Apply a unified diff patch to a file. A backup is saved.\n';
  prompt +=
    '- undo: List available backups or restore a file from a previous backup. Use this to recover from mistakes.\n';
  if (allowShell) {
    prompt += '- bash: Run a shell command inside the project directory (timeout + output limits apply).\n';
  }
  prompt += '\n## Rules\n\n';
  prompt += '1. You may only use the tools listed above.\n';
  prompt += '2. You may only access paths inside the working directory.\n';
  prompt +=
    '3. When editing a file, use the exact text from the file for old_string. Copy it precisely including indentation.\n';
  prompt += '4. If old_string matches multiple times, include more surrounding lines to make it unique.\n';
  prompt += '5. After making edits, consider running validation (lint, tests) using bash if available.\n';
  prompt += '6. If a validation step fails, read the error and try to fix the issue.\n';
  prompt += '7. Never suggest editing .env files, credentials, private keys, or git config.\n';
  prompt += '8. If you have enough information to answer without making changes, return a FINAL answer.\n';
  prompt += '9. When you call a tool, wait for the result before calling another.\n';
  return prompt;
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

module.exports = { buildSystem, buildUserMessage, buildToolResultMessage };
