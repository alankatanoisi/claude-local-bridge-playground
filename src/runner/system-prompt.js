'use strict';

/**
 * system-prompt.js — Assemble final system prompt from builder output and CLI overrides.
 */

const fs = require('fs');
const path = require('path');
const { buildSystem } = require('./context-builder');

function userHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function readPromptFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return '';
  return fs.readFileSync(filePath, 'utf8').trim();
}

function conventionalPromptFiles(ctx) {
  const cwd = ctx && (ctx.cwdRealpath || ctx.cwd);
  const home = userHome();
  const globalDir = home ? path.join(home, '.bridge-runner') : null;
  const projectDir = cwd ? path.join(cwd, '.bridge-runner') : null;

  return {
    systemFiles: [
      globalDir && path.join(globalDir, 'SYSTEM.md'),
      projectDir && path.join(projectDir, 'SYSTEM.md'),
    ].filter(Boolean),
    appendFiles: [
      globalDir && path.join(globalDir, 'APPEND_SYSTEM.md'),
      projectDir && path.join(projectDir, 'APPEND_SYSTEM.md'),
    ].filter(Boolean),
  };
}

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
    const files = conventionalPromptFiles(ctx);
    for (const filePath of files.systemFiles) {
      const text = readPromptFile(filePath);
      if (text) base = text;
    }
    if (!base) base = buildSystem(ctx, { progressive, contextPolicy });
  }

  if (!options.systemPromptOverride) {
    const files = conventionalPromptFiles(ctx);
    for (const filePath of files.appendFiles) {
      const extra = readPromptFile(filePath);
      if (extra) base = base ? base + '\n\n' + extra : extra;
    }
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
  conventionalPromptFiles,
  resolveSystemPrompt,
};
