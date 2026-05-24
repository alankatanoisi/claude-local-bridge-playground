#!/usr/bin/env node
'use strict';

/**
 * Top-level orchestrating agent CLI (playground).
 *
 * Phases: research -> synthesize -> execute -> verify
 */

const { parseArgs } = require('util');
const path = require('path');
const { Coordinator } = require('../src/runner/coordinator');

const DEFAULT_MODEL = 'claude-sonnet-4-6';

async function main() {
  const args = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      cwd: { type: 'string' },
      model: { type: 'string' },
      'max-tokens': { type: 'string' },
      phases: { type: 'string' },
      'no-workers': { type: 'boolean' },
      'output-format': { type: 'string' },
      'session-id': { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  if (args.values.help) {
    console.log(`local-bridge-coordinator — phased top-level agent (playground)

Usage:
  node bin/local-bridge-coordinator.js [options] <objective>

Options:
  --cwd <path>           Project folder (default: current directory)
  --model <model>        Model name (default: ${DEFAULT_MODEL})
  --max-tokens <n>       Max tokens per kernel request
  --phases <list>        Comma-separated: research,synthesize,execute,verify
  --no-workers           Skip read-only worker subprocesses for research/verify
  --output-format <f>    text | json | stream-json (passed to execute phase)
  --session-id <id>      Canonical session id for state file
  --help                 Show help
`);
    process.exit(0);
  }

  const objective = args.positionals.join(' ').trim();
  if (!objective) {
    console.error('Error: no objective provided.');
    process.exit(1);
  }

  const cwd = path.resolve(args.values.cwd || process.cwd());
  const phases = args.values.phases
    ? args.values.phases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const coordinator = new Coordinator({ streamEvents: args.values['output-format'] === 'stream-json' });
  const result = await coordinator.run({
    objective,
    cwd,
    model: args.values.model || DEFAULT_MODEL,
    maxTokens: parseInt(args.values['max-tokens'], 10) || 2000,
    phases,
    useWorkers: !args.values['no-workers'],
    outputFormat: args.values['output-format'] || 'text',
    sessionId: args.values['session-id'],
  });

  if (args.values['output-format'] === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.kernelResult && result.kernelResult.finalText) {
    console.log(result.kernelResult.finalText);
  } else if (result.synthesis) {
    console.log(result.synthesis);
  }

  process.exit(result.kernelResult && result.kernelResult.stopReason === 'success' ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Coordinator error: ' + err.message);
    process.exit(1);
  });
}

module.exports = { main };
