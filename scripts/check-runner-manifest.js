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
 *
 * When the runtime gains a tool or flag and the docs are not updated, this
 * check fails loudly with the exact missing names.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const { TOOLS, CATEGORIES, DEFAULT_HIDDEN_TOOLS } = require(path.join(root, 'src/runner/tool-catalog.js'));

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const builderHtml = fs.readFileSync(path.join(root, 'docs', 'command-builder.html'), 'utf8');
const binSource = fs.readFileSync(path.join(root, 'bin', 'local-bridge-runner.js'), 'utf8');

const errors = [];

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
// default-visible set (catalog minus hidden minus dynamically gated tools).
const DYNAMICALLY_HIDDEN = new Set(['bash', 'manage_shell_jobs', 'lsp_query']);
const runtimeDefaults = toolNames.filter((n) => !DEFAULT_HIDDEN_TOOLS.has(n) && !DYNAMICALLY_HIDDEN.has(n)).sort();

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

if (errors.length) {
  console.error('Runner manifest check failed (' + errors.length + ' issue(s)):');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log('Runner manifest check passed.');
console.log('- tools: ' + toolNames.length + ' (hidden by default: ' + [...DEFAULT_HIDDEN_TOOLS].join(', ') + ')');
console.log('- CLI flags: ' + (cliFlags ? cliFlags.length : 0));
