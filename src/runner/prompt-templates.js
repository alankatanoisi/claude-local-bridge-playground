'use strict';

// Thin compatibility layer over the prompt-template registry (prompts/registry.js).
//
// History: this module used to hold the built-in templates inline as a frozen
// object and read project/global ".bridge-runner/prompts/*.md" as raw text.
// The registry (roadmap §4.6) is now the source of truth — built-ins live as
// Markdown files with frontmatter under src/runner/prompts/, and the registry
// handles override order, parameter parsing, and substitution. This file keeps
// the original public API (resolvePromptTemplate / applyPromptTemplates /
// BUILT_IN_TEMPLATES) so existing callers and the CLI keep working unchanged.

const path = require('path');
const registry = require('./prompts/registry');

// Built-in template bodies, derived from the shipped Markdown files. Kept for
// backward compatibility; new code should prefer the registry directly.
const BUILT_IN_TEMPLATES = Object.freeze(
  Object.fromEntries(
    registry
      .listBuiltinNames()
      .map((name) => [name, registry.loadBuiltin(name)])
      .filter(([, prompt]) => prompt)
      .map(([name, prompt]) => [name, prompt.body]),
  ),
);

function looksLikePath(nameOrPath) {
  const key = String(nameOrPath || '').trim();
  return path.isAbsolute(key) || key.includes(path.sep);
}

/**
 * Resolve a prompt template by name or path.
 *
 * Returns { name, source, text, prompt } where `text` is the prompt body
 * (frontmatter stripped) and `prompt` is the full registry object (parameters,
 * recommended tools/permissions, …) — or undefined for a raw path with no
 * frontmatter. Built-in sources are labelled `builtin:<name>`.
 */
function resolvePromptTemplate(cwd, nameOrPath) {
  const key = String(nameOrPath || '').trim();
  if (!key) throw new Error('Prompt template name cannot be empty.');

  if (looksLikePath(key)) {
    const prompt = registry.loadPromptFromPath(cwd, key);
    if (!prompt) throw new Error('Prompt template file not found: ' + key);
    return { name: prompt.name, source: prompt.source, text: prompt.body, prompt };
  }

  // Bare name — strip a redundant .md so "review.md" still resolves "review".
  const name = key.endsWith('.md') ? key.slice(0, -3) : key;
  const prompt = registry.loadPrompt(cwd, name);
  if (prompt) {
    return { name: prompt.name, source: prompt.source, text: prompt.body, prompt };
  }

  const available = registry.listPrompts(cwd).map((p) => p.name);
  throw new Error(
    'Prompt template not found: ' +
      key +
      '. Try one of: ' +
      available.join(', ') +
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
  // Re-exported for the CLI's --prompt-arg substitution path.
  substituteParameters: registry.substituteParameters,
};
