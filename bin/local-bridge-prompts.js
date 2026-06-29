#!/usr/bin/env node
'use strict';

/**
 * bin/local-bridge-prompts.js — browse and validate the prompt-template registry.
 *
 * Prompt templates are reusable instruction snippets prepended to your request
 * with `--prompt-template <name>`. Built-ins ship under src/runner/prompts/; you
 * can add or override them per project under .bridge-runner/prompts/<name>.md or
 * globally under ~/.bridge-runner/prompts/<name>.md.
 *
 * Where to run it: a Terminal in the playground folder. Use --cwd to point at a
 * different project whose .bridge-runner/prompts/ you want to inspect.
 *
 * Usage:
 *   node bin/local-bridge-prompts.js list [--cwd <path>] [--json]
 *   node bin/local-bridge-prompts.js show <name> [--cwd <path>] [--json]
 *   node bin/local-bridge-prompts.js validate [name] [--cwd <path>] [--json]
 */

const { parseArgs } = require('util');
const path = require('path');
const registry = require('../src/runner/prompts/registry');

function showHelp() {
  console.log(`local-bridge-prompts — browse the prompt-template registry

Usage:
  node bin/local-bridge-prompts.js <command> [options]

Commands:
  list                 List available prompt templates (project > global > built-in)
  show <name>          Print a template's metadata and body
  validate [name]      Validate one template, or all of them; non-zero exit on errors

Options:
  --cwd <path>         Project folder whose .bridge-runner/prompts/ to read
  --json               Machine-readable output
  --help               Show this help

Templates resolve in this order (first match wins):
  <cwd>/.bridge-runner/prompts/<name>.md   (project)
  ~/.bridge-runner/prompts/<name>.md       (global)
  built-in (shipped with the runner)
`);
}

function paramLabel(parameters) {
  if (!parameters || parameters.length === 0) return '';
  return ' [' + parameters.map((p) => (p.required ? p.name : p.name + '?')).join(', ') + ']';
}

function cmdList(cwd, values) {
  const prompts = registry.listPrompts(cwd);
  if (values.json) {
    console.log(
      JSON.stringify(
        prompts.map((p) => ({
          name: p.name,
          scope: p.scope,
          title: p.title,
          summary: p.summary,
          parameters: p.parameters,
          recommendedTools: p.recommendedTools,
          recommendedPermissions: p.recommendedPermissions,
          tags: p.tags,
          source: p.source,
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (prompts.length === 0) {
    console.log('No prompt templates found.');
    return;
  }
  console.log('Prompt templates (project > global > built-in):\n');
  for (const p of prompts) {
    console.log('  ' + p.name + paramLabel(p.parameters) + '  (' + p.scope + ')');
    if (p.summary) console.log('      ' + p.summary);
  }
  console.log('\nUse:  node bin/local-bridge-runner.js --prompt-template <name> [--prompt-arg key=value] "<request>"');
}

function cmdShow(cwd, name, values) {
  if (!name) {
    console.error('Usage: show <name>');
    process.exit(1);
  }
  const prompt = registry.loadPrompt(cwd, name);
  if (!prompt) {
    console.error('Prompt template not found: ' + name);
    process.exit(1);
  }
  if (values.json) {
    console.log(JSON.stringify(prompt, null, 2));
    return;
  }
  console.log('Template: ' + prompt.name + '  (' + prompt.scope + ')');
  console.log('  source: ' + prompt.source);
  if (prompt.title) console.log('  title: ' + prompt.title);
  if (prompt.summary) console.log('  summary: ' + prompt.summary);
  if (prompt.parameters.length) console.log('  parameters:' + paramLabel(prompt.parameters));
  if (prompt.recommendedPermissions.length)
    console.log('  recommended permissions: ' + prompt.recommendedPermissions.join(', '));
  if (prompt.recommendedTools.length) console.log('  recommended tools: ' + prompt.recommendedTools.join(', '));
  if (prompt.tags.length) console.log('  tags: ' + prompt.tags.join(', '));
  console.log('\n--- body ---\n' + prompt.body);
}

function cmdValidate(cwd, name, values) {
  const report = registry.validatePrompts(cwd, name);
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
  for (const result of report.results) {
    const status = result.errors.length ? 'FAIL' : 'ok';
    console.log('[' + status + '] ' + result.name + '  (' + (result.source || '') + ')');
    for (const err of result.errors) console.log('    error: ' + err);
    for (const warn of result.warnings) console.log('    warn:  ' + warn);
  }
  console.log('\n' + (report.ok ? 'All templates valid.' : 'Validation failed.'));
  process.exit(report.ok ? 0 : 1);
}

function main() {
  let args;
  try {
    args = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        cwd: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch (err) {
    console.error('Error parsing arguments: ' + err.message);
    process.exit(1);
  }

  if (args.values.help || args.positionals.length === 0) {
    showHelp();
    process.exit(args.positionals.length === 0 ? 1 : 0);
  }

  const command = args.positionals[0];
  const cwd = path.resolve(args.values.cwd || process.cwd());

  switch (command) {
    case 'list':
      cmdList(cwd, args.values);
      break;
    case 'show':
      cmdShow(cwd, args.positionals[1], args.values);
      break;
    case 'validate':
      cmdValidate(cwd, args.positionals[1], args.values);
      break;
    default:
      console.error('Unknown command: ' + command);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
