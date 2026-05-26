'use strict';

/**
 * system-prompt.js — Assemble final system prompt from builder output and CLI overrides.
 */

const fs = require('fs');
const { buildSystem } = require('./context-builder');

/**
 * @param {object} ctx
 * @param {object} options
 * @returns {string}
 */
function resolveSystemPrompt(ctx, options = {}) {
  const contextPolicy = options.contextPolicy;
  const progressive = options.progressive !== false;

  let base = '';
  if (options.systemPromptOverride) {
    base = options.systemPromptOverride;
  } else if (options.systemPromptFile) {
    base = fs.readFileSync(options.systemPromptFile, 'utf8').trim();
  } else {
    base = buildSystem(ctx, { progressive, contextPolicy });
  }

  if (options.appendSystemPrompt) {
    base = base ? base + '\n\n' + options.appendSystemPrompt.trim() : options.appendSystemPrompt.trim();
  }
  if (options.appendSystemPromptFile) {
    const extra = fs.readFileSync(options.appendSystemPromptFile, 'utf8').trim();
    base = base ? base + '\n\n' + extra : extra;
  }

  return base;
}

module.exports = {
  resolveSystemPrompt,
};
