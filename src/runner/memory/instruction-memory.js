'use strict';

/**
 * Instruction memory — hierarchical config: org -> user -> project -> local.
 * Later scopes override earlier (local wins).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_FILES = ['AGENTS.md', 'CLAUDE.md', 'OPENCODE.md', 'RUNNER.md'];
const MAX_INSTRUCTION_CHARS = 24_000;

function readBoundedFile(filePath, scope, priority) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_INSTRUCTION_CHARS) return null;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    return {
      scope,
      path: filePath,
      priority,
      chars: content.length,
      hash,
      text: '<!-- instruction:' + scope + ':' + path.basename(filePath) + ' -->\n' + content,
    };
  } catch {
    return null;
  }
}

function discoverInstructionBlocks(cwd) {
  const blocks = [];
  let priority = 0;

  const orgRoot = process.env.BRIDGE_RUNNER_ORG_INSTRUCTIONS;
  if (orgRoot && fs.existsSync(orgRoot)) {
    for (const name of MEMORY_FILES) {
      const b = readBoundedFile(path.join(orgRoot, name), 'org', priority++);
      if (b) blocks.push(b);
    }
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const userDirs = [path.join(home, '.bridge-runner', 'instructions'), path.join(home, '.config', 'runner')];
  for (const dir of userDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of MEMORY_FILES) {
      const b = readBoundedFile(path.join(dir, name), 'user', priority++);
      if (b) blocks.push(b);
    }
    const runnerMd = readBoundedFile(path.join(dir, 'RUNNER.md'), 'user', priority++);
    if (runnerMd) blocks.push(runnerMd);
  }

  for (const name of MEMORY_FILES) {
    const b = readBoundedFile(path.join(cwd, name), 'project', priority++);
    if (b) blocks.push(b);
  }

  const localDir = path.join(cwd, '.bridge-runner', 'instructions');
  if (fs.existsSync(localDir)) {
    for (const name of fs.readdirSync(localDir)) {
      if (!name.endsWith('.md')) continue;
      const b = readBoundedFile(path.join(localDir, name), 'local', priority++);
      if (b) blocks.push(b);
    }
  }
  const localOverride = readBoundedFile(path.join(cwd, 'AGENTS.local.md'), 'local', priority++);
  if (localOverride) blocks.push(localOverride);
  const runnerLocal = readBoundedFile(path.join(cwd, 'RUNNER.local.md'), 'local', priority++);
  if (runnerLocal) blocks.push(runnerLocal);

  blocks.sort((a, b) => a.priority - b.priority);
  return blocks;
}

/**
 * @param {string} cwd
 * @returns {{ sources: string[], blocks: object[], text: string, hash: string }}
 */
function loadInstructionMemory(cwd) {
  const discovered = discoverInstructionBlocks(cwd);
  let text = discovered.map((b) => b.text).join('\n\n');
  if (text.length > MAX_INSTRUCTION_CHARS) {
    text = text.slice(0, MAX_INSTRUCTION_CHARS) + '\n... [instruction memory truncated]';
  }
  const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const sources = discovered.map((b) => b.scope + ':' + path.basename(b.path));
  const blocks = text ? [{ type: 'text', text: '## Instruction memory\n\n' + text }] : [];
  return { sources, blocks, text, hash, structured: discovered };
}

module.exports = { loadInstructionMemory, discoverInstructionBlocks, MEMORY_FILES, MAX_INSTRUCTION_CHARS };
