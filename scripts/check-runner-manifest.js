#!/usr/bin/env node
'use strict';

/**
 * check-runner-manifest.js — generated-manifest drift gate for `npm run check:docs`.
 *
 * Instead of trusting hand-copied lists, this script GENERATES the runner's
 * real surface from the code and compares it against the human docs:
 *
 *   1. Tool manifest  — from src/runner/tool-catalog.js (names, categories,
 *      hidden set). Every tool must be mentioned in README.md and
 *      docs/command-builder.html.
 *   2. CLI flag manifest — parsed from the parseArgs options block in
 *      bin/local-bridge-runner.js. Every flag must appear in the --help text,
 *      and user-facing flags must appear in README.md.
 *   3. Command-builder default tool list — must equal the runtime's no-flag
 *      surface (isToolVisible with an empty ctx).
 *   4. Model choices — every model offered in docs/command-builder.html's
 *      `<select id="model">` must be known to the runtime catalog
 *      (src/runner/model-catalog.js) and the default-selected option must equal
 *      the runtime DEFAULT_MODEL.
 *   5. Effort levels + thinking modes — the builder's `<select id="effort">`
 *      and `<select id="thinking">` values, plus README's `--effort`/`--thinking`
 *      vocabulary, must equal src/runner/model-capabilities.js
 *      (EFFORT_LEVELS / THINKING_MODES).
 *   6. Prompt templates — the builder's PROMPT_REGISTRY keys and the
 *      `<select id="promptTemplate">` options must equal the runtime built-in
 *      template registry (src/runner/prompts/registry.js listBuiltinNames()).
 *   7. Quickstart tool coverage — docs/runner-quickstart.html must mention every
 *      non-hidden catalog tool.
 *
 * Every expectation is DERIVED from the runtime modules (required below), never
 * a hand-copied list. When the runtime gains a tool, flag, model, effort level,
 * thinking mode, or prompt template and the docs are not updated, this check
 * fails loudly with the exact drift.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const { TOOLS, CATEGORIES, DEFAULT_HIDDEN_TOOLS } = require(path.join(root, 'src/runner/tool-catalog.js'));
const { isToolVisible } = require(path.join(root, 'src/runner/tool-visibility.js'));
const { catalogEntryForModel, DEFAULT_MODEL } = require(path.join(root, 'src/runner/model-catalog.js'));
const { EFFORT_LEVELS, THINKING_MODES } = require(path.join(root, 'src/runner/model-capabilities.js'));
const promptRegistry = require(path.join(root, 'src/runner/prompts/registry.js'));

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const builderHtml = fs.readFileSync(path.join(root, 'docs', 'command-builder.html'), 'utf8');
const quickstartHtml = fs.readFileSync(path.join(root, 'docs', 'runner-quickstart.html'), 'utf8');
const binSource = fs.readFileSync(path.join(root, 'bin', 'local-bridge-runner.js'), 'utf8');

const errors = [];

// Pull the option values out of a `<select id="…">` block in the command
// builder. Returns { values, selected } or null when the block is missing.
function extractSelectOptions(html, id) {
  const block = html.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'));
  if (!block) return null;
  const optionRe = /<option value="([^"]*)"([^>]*)>/g;
  const values = [];
  let selected = null;
  let m;
  while ((m = optionRe.exec(block[1])) !== null) {
    values.push(m[1]);
    if (/\bselected\b/.test(m[2])) selected = m[1];
  }
  return { values, selected };
}

// ── 1. Tool manifest vs docs ──

const toolNames = Object.keys(TOOLS);
for (const name of toolNames) {
  if (!readme.includes('`' + name + '`') && !readme.includes(name)) {
    errors.push('README.md does not mention tool "' + name + '" (category: ' + CATEGORIES[name] + ')');
  }
  if (!builderHtml.includes(name)) {
    errors.push('docs/command-builder.html does not mention tool "' + name + '"');
  }
}

// ── 2. CLI flag manifest vs help text and README ──

// Extract flag names from the parseArgs `options: { ... }` block. Flags are
// declared one per line as  `flag: { type: ...`  or  `'flag-name': { type: ...`.
function extractCliFlags(source) {
  const optionsMatch = source.match(/options:\s*\{([\s\S]*?)\n\s{6}\},/);
  if (!optionsMatch) return null;
  const flags = [];
  const lineRe = /^\s*'?([a-z][a-z0-9-]*)'?:\s*\{\s*type:/gm;
  let m;
  while ((m = lineRe.exec(optionsMatch[1])) !== null) flags.push(m[1]);
  return flags;
}

// Flags that are deliberately not advertised in README prose (internal or
// maintenance surfaces). They must still appear in --help unless listed in
// HELP_EXEMPT below.
const README_EXEMPT = new Set([
  'update', // golden-eval refresh switch, documented next to `runner eval`
  'replay', // ledger maintenance surface
  'repair', // ledger maintenance surface
  'template', // alias of --prompt-template
]);
const HELP_EXEMPT = new Set(['update', 'replay', 'repair']);

const cliFlags = extractCliFlags(binSource);
if (!cliFlags || cliFlags.length === 0) {
  errors.push('Could not extract CLI flags from bin/local-bridge-runner.js (parseArgs options block moved?)');
} else {
  for (const flag of cliFlags) {
    if (!HELP_EXEMPT.has(flag) && !binSource.includes('--' + flag)) {
      errors.push('CLI flag "--' + flag + '" is missing from the --help text in bin/local-bridge-runner.js');
    }
    if (!README_EXEMPT.has(flag) && !readme.includes('--' + flag)) {
      errors.push('README.md does not document CLI flag "--' + flag + '"');
    }
  }
}

// ── 3. Command-builder default tool list vs runtime ──

// The builder hard-codes DEFAULT_TOOL_NAMES; it must equal the runtime's
// no-flag default surface, computed by the runtime's own visibility function
// with an empty ctx (P2-01: the seven-tool core, no opt-ins).
const runtimeDefaults = toolNames.filter((n) => isToolVisible(n, {})).sort();

const builderConstMatch = builderHtml.match(/const\s+DEFAULT_TOOL_NAMES\s*=\s*\[([^\]]*)\]/s);
if (!builderConstMatch) {
  errors.push('docs/command-builder.html no longer defines DEFAULT_TOOL_NAMES');
} else {
  const builderDefaults = [...builderConstMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  if (JSON.stringify(builderDefaults) !== JSON.stringify(runtimeDefaults)) {
    errors.push(
      'command-builder DEFAULT_TOOL_NAMES drifted from runtime: builder=[' +
        builderDefaults.join(', ') +
        '] runtime=[' +
        runtimeDefaults.join(', ') +
        ']',
    );
  }
}

// ── 4. Command-builder model choices vs runtime model catalog ──

// Every model the builder offers must be a model the runtime actually knows
// (so the builder never hands the user a model the runner cannot price or
// validate effort/thinking for), and the default-selected option must be the
// runtime's shared DEFAULT_MODEL. Catalog matching is regex/family based, so we
// only assert the docs→runtime direction (offered ⊆ known); the catalog may
// legitimately recognize more models than the builder chooses to list.
const modelSelect = extractSelectOptions(builderHtml, 'model');
if (!modelSelect) {
  errors.push('docs/command-builder.html no longer has a <select id="model"> block');
} else {
  for (const value of modelSelect.values) {
    if (!catalogEntryForModel(value)) {
      errors.push(
        'command-builder offers model "' +
          value +
          '" that is unknown to the runtime catalog (src/runner/model-catalog.js)',
      );
    }
  }
  if (modelSelect.selected !== DEFAULT_MODEL) {
    errors.push(
      'command-builder default-selected model "' +
        modelSelect.selected +
        '" != runtime DEFAULT_MODEL "' +
        DEFAULT_MODEL +
        '"',
    );
  }
}

// ── 5. Effort levels + thinking modes vs runtime ──

// The builder's effort dropdown carries a leading empty "(default)" option that
// maps to "omit --effort"; the remaining values must equal the runtime vocabulary
// exactly (order included). Thinking has no empty option.
const effortSelect = extractSelectOptions(builderHtml, 'effort');
if (!effortSelect) {
  errors.push('docs/command-builder.html no longer has a <select id="effort"> block');
} else {
  const builderEfforts = effortSelect.values.filter((v) => v !== '');
  if (JSON.stringify(builderEfforts) !== JSON.stringify([...EFFORT_LEVELS])) {
    errors.push(
      'command-builder effort levels drifted from runtime: builder=[' +
        builderEfforts.join(', ') +
        '] runtime=[' +
        EFFORT_LEVELS.join(', ') +
        ']',
    );
  }
}

const thinkingSelect = extractSelectOptions(builderHtml, 'thinking');
if (!thinkingSelect) {
  errors.push('docs/command-builder.html no longer has a <select id="thinking"> block');
} else if (JSON.stringify(thinkingSelect.values) !== JSON.stringify([...THINKING_MODES])) {
  errors.push(
    'command-builder thinking modes drifted from runtime: builder=[' +
      thinkingSelect.values.join(', ') +
      '] runtime=[' +
      THINKING_MODES.join(', ') +
      ']',
  );
}

// README must document each runtime effort level and thinking mode (backticked
// in the --effort / --thinking table rows).
for (const level of EFFORT_LEVELS) {
  if (!readme.includes('`' + level + '`')) {
    errors.push('README.md does not document effort level "' + level + '" for --effort');
  }
}
for (const mode of THINKING_MODES) {
  if (!readme.includes('`' + mode + '`')) {
    errors.push('README.md does not document thinking mode "' + mode + '" for --thinking');
  }
}

// ── 6. Prompt templates vs runtime built-in registry ──

const builtinTemplateNames = promptRegistry.listBuiltinNames().slice().sort();

// PROMPT_REGISTRY keys (each built-in template is one line: `name: { … },`).
const promptRegistryMatch = builderHtml.match(/const\s+PROMPT_REGISTRY\s*=\s*\{([\s\S]*?)\n\s*\};/);
if (!promptRegistryMatch) {
  errors.push('docs/command-builder.html no longer defines PROMPT_REGISTRY');
} else {
  const keys = [...promptRegistryMatch[1].matchAll(/^\s*([a-z][a-z0-9_-]*)\s*:/gim)].map((m) => m[1]).sort();
  if (JSON.stringify(keys) !== JSON.stringify(builtinTemplateNames)) {
    errors.push(
      'command-builder PROMPT_REGISTRY keys drifted from runtime built-in templates: builder=[' +
        keys.join(', ') +
        '] runtime=[' +
        builtinTemplateNames.join(', ') +
        ']',
    );
  }
}

// The promptTemplate <select> carries a leading empty "none" option; the rest
// must equal the built-in template set.
const promptSelect = extractSelectOptions(builderHtml, 'promptTemplate');
if (!promptSelect) {
  errors.push('docs/command-builder.html no longer has a <select id="promptTemplate"> block');
} else {
  const offered = promptSelect.values.filter((v) => v !== '').sort();
  if (JSON.stringify(offered) !== JSON.stringify(builtinTemplateNames)) {
    errors.push(
      'command-builder promptTemplate options drifted from runtime built-in templates: builder=[' +
        offered.join(', ') +
        '] runtime=[' +
        builtinTemplateNames.join(', ') +
        ']',
    );
  }
}

// ── 7. Quickstart tool coverage ──

// The quickstart's "Available tools" section must mention every non-hidden
// catalog tool (apply_patch is hidden-by-default, so it is exempt).
const nonHiddenTools = toolNames.filter((n) => !DEFAULT_HIDDEN_TOOLS.has(n));
for (const name of nonHiddenTools) {
  if (!quickstartHtml.includes(name)) {
    errors.push('docs/runner-quickstart.html does not mention non-hidden tool "' + name + '"');
  }
}

if (errors.length) {
  console.error('Runner manifest check failed (' + errors.length + ' issue(s)):');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log('Runner manifest check passed.');
console.log('- tools: ' + toolNames.length + ' (hidden by default: ' + [...DEFAULT_HIDDEN_TOOLS].join(', ') + ')');
console.log('- CLI flags: ' + (cliFlags ? cliFlags.length : 0));
console.log('- models offered: ' + (modelSelect ? modelSelect.values.length : 0) + ' (default: ' + DEFAULT_MODEL + ')');
console.log('- effort levels: ' + EFFORT_LEVELS.join(', '));
console.log('- thinking modes: ' + THINKING_MODES.join(', '));
console.log('- built-in prompt templates: ' + builtinTemplateNames.join(', '));
console.log('- quickstart non-hidden tool coverage: ' + nonHiddenTools.length);
