#!/usr/bin/env node
'use strict';

/**
 * Top-level orchestrating agent CLI (playground).
 *
 * Phases: research -> synthesize -> execute -> verify
 */

const { parseArgs } = require('util');
const fs = require('fs');
const path = require('path');
const { Coordinator } = require('../src/runner/coordinator');

// Share the runner's single versioned model default instead of maintaining a
// second hardcoded copy that can silently drift after Anthropic model updates.
const { DEFAULT_MODEL } = require('../src/runner/model-catalog');

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
      // Ceilings. Coordinator.run already read these input keys; only this CLI
      // surface was missing, so a coordinator run had no cost cap at all.
      'max-cost-usd': { type: 'string' },
      'budget-input-tokens': { type: 'string' },
      'budget-output-tokens': { type: 'string' },
      'max-wall-clock-ms': { type: 'string' },
      'no-network': { type: 'boolean' },
      'trace-level': { type: 'string' },
      // Fan-out plan: JSON array of { id, deps[], prompt, allowedTools?, maxSteps? }.
      'research-plan': { type: 'string' },
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
  --max-tokens <n>       Max output tokens per model request (execute kernel AND
                         research/verify workers via inherit; plan nodes may set
                         "maxTokens" to override per worker)
  --phases <list>        Comma-separated: research,synthesize,execute,verify
  --no-workers           Skip read-only worker subprocesses for research/verify
  --output-format <f>    text | json | stream-json (passed to execute phase)
  --session-id <id>      Canonical session id for state file

Ceilings (children receive a lease of these, not a copy):
  --max-cost-usd <n>          Cost ceiling inherited by workers
  --budget-input-tokens <n>   Input-token cap for the run; leased across workers
  --budget-output-tokens <n>  Output-token cap for the run; leased across workers
  --max-wall-clock-ms <n>     Wall-clock ceiling inherited by workers
  --no-network                Forbid network use in workers
  --trace-level <level>       Trace level inherited by workers

Fan-out:
  --research-plan <file>      JSON array of research nodes to run concurrently:
                              [{ "id": "a", "deps": [], "prompt": "…",
                                 "maxSteps": 10, "maxTokens": 4000 }, …]
                              Nodes with no unmet deps run in the same batch, and
                              the token remainder is split across that batch.
                              Omit for the single-research-worker behaviour.
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

  // Parse a numeric flag, returning null when absent so "no ceiling" stays
  // distinct from zero (a 0 cap would refuse every worker).
  const num = (name) => {
    const raw = args.values[name];
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      console.error('Error: --' + name + ' must be a non-negative number.');
      process.exit(1);
    }
    return n;
  };

  // Load the fan-out plan up front: a malformed plan should fail before any
  // worker is spawned or any token is spent.
  let researchPlan = null;
  const planPath = args.values['research-plan'];
  if (planPath) {
    let raw;
    try {
      raw = fs.readFileSync(path.resolve(planPath), 'utf8');
    } catch (err) {
      console.error('Error: cannot read --research-plan file: ' + err.message);
      process.exit(1);
    }
    try {
      researchPlan = JSON.parse(raw);
    } catch (err) {
      console.error('Error: --research-plan is not valid JSON: ' + err.message);
      process.exit(1);
    }
    if (!Array.isArray(researchPlan) || researchPlan.length === 0) {
      console.error('Error: --research-plan must be a non-empty JSON array of nodes.');
      process.exit(1);
    }
    for (const node of researchPlan) {
      if (!node || typeof node.id !== 'string' || !node.id.trim()) {
        console.error('Error: every --research-plan node needs a non-empty string id.');
        process.exit(1);
      }
    }
  }

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
    researchPlan,
    maxCostUsd: num('max-cost-usd'),
    budgetInputTokens: num('budget-input-tokens'),
    budgetOutputTokens: num('budget-output-tokens'),
    maxWallClockMs: num('max-wall-clock-ms'),
    noNetwork: !!args.values['no-network'],
    traceLevel: args.values['trace-level'] || null,
  });

  if (args.values['output-format'] === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.kernelResult && result.kernelResult.finalText) {
    console.log(result.kernelResult.finalText);
  } else if (result.synthesis) {
    console.log(result.synthesis);
  }

  process.exit(exitCodeForCoordinatorResult(result));
}

/**
 * A3-F1: research-only / no-execute runs used to always exit 1 because the CLI
 * keyed solely on `kernelResult.stopReason === 'success'`, and kernelResult is
 * null when the execute phase is skipped. Shell scripts then treated a clean
 * research fan-out as a failure despite `error: null`.
 *
 * Rules:
 *   - any result.error → 1
 *   - execute ran → kernelResult.stopReason === 'success' ? 0 : 1
 *   - no execute phase → 0 when error is null (research/synthesize success)
 */
function exitCodeForCoordinatorResult(result) {
  if (!result) return 1;
  if (result.error) return 1;
  const phases = Array.isArray(result.phases) ? result.phases : [];
  if (phases.includes('execute')) {
    const kr = result.kernelResult;
    if (!kr) return 1;
    return kr.stopReason === 'success' ? 0 : 1;
  }
  return 0;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Coordinator error: ' + err.message);
    process.exit(1);
  });
}

module.exports = { main, exitCodeForCoordinatorResult };
