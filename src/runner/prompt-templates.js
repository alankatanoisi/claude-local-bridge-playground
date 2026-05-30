'use strict';

const fs = require('fs');
const path = require('path');

const BUILT_IN_TEMPLATES = Object.freeze({
  review:
    'Review the relevant code for correctness, safety, maintainability, and missing tests. ' +
    'Lead with concrete findings, then mention any residual risk.',
  cleanup:
    'Simplify the relevant code or docs while preserving behavior. Prefer deleting stale paths, reducing duplicated logic, and keeping changes easy to review.',
  explore:
    'Explore read-only. Inspect before concluding, avoid edits and shell unless explicitly requested, and summarize the structure, important files, and practical next steps.',
});

function userHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function templateDirs(cwd) {
  const dirs = [];
  if (cwd) dirs.push(path.join(cwd, '.bridge-runner', 'prompts'));
  const home = userHome();
  if (home) dirs.push(path.join(home, '.bridge-runner', 'prompts'));
  return dirs;
}

function readIfFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  return fs.readFileSync(filePath, 'utf8').trim();
}

function candidatePaths(cwd, nameOrPath) {
  if (path.isAbsolute(nameOrPath) || nameOrPath.includes(path.sep)) {
    return [path.resolve(cwd || process.cwd(), nameOrPath)];
  }

  const names = nameOrPath.endsWith('.md') ? [nameOrPath] : [nameOrPath + '.md', nameOrPath];
  const candidates = [];
  for (const dir of templateDirs(cwd)) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  return candidates;
}

function resolvePromptTemplate(cwd, nameOrPath) {
  const key = String(nameOrPath || '').trim();
  if (!key) throw new Error('Prompt template name cannot be empty.');

  for (const filePath of candidatePaths(cwd, key)) {
    const text = readIfFile(filePath);
    if (text) return { name: key, source: filePath, text };
  }

  if (BUILT_IN_TEMPLATES[key]) {
    return { name: key, source: 'builtin:' + key, text: BUILT_IN_TEMPLATES[key] };
  }

  throw new Error(
    'Prompt template not found: ' +
      key +
      '. Try one of: ' +
      Object.keys(BUILT_IN_TEMPLATES).sort().join(', ') +
      ', or add a Markdown file under .bridge-runner/prompts/.',
  );
}

function applyPromptTemplates(prompt, templates) {
  if (!templates || templates.length === 0) return prompt;

  const blocks = templates.map((template) => '## Prompt template: ' + template.name + '\n\n' + template.text);
  blocks.push('## User request\n\n' + prompt);
  return blocks.join('\n\n---\n\n');
}

module.exports = {
  BUILT_IN_TEMPLATES,
  applyPromptTemplates,
  resolvePromptTemplate,
};
