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
const { Coordinator, PHASES } = require('../src/runner/coordinator');
const { resolveModelControls } = require('../src/runner/model-capabilities');
const { normalizeCapabilityList } = require('../src/runner/tool-visibility');
const { evaluateWorkspaceTrust } = require('../src/runner/workspace-trust');
const safety = require('../src/runner/safety');

// Share the runner's single versioned model default instead of maintaining a
// second hardcoded copy that can silently drift after Anthropic model updates.
const { DEFAULT_MODEL } = require('../src/runner/model-catalog');

// Export the parser schema so the command-builder drift test can compare its
// advertised flags with the live coordinator CLI instead of maintaining a
// second, hand-written flag inventory.
const COORDINATOR_CLI_OPTIONS = Object.freeze({
  cwd: { type: 'string' },
  model: { type: 'string' },
  'max-tokens': { type: 'string' },
  'max-steps': { type: 'string' },
  phases: { type: 'string' },
  'no-workers': { type: 'boolean' },
  'output-format': { type: 'string' },
  'session-id': { type: 'string' },
  effort: { type: 'string' },
  thinking: { type: 'string' },
  temperature: { type: 'string' },
  'bridge-url': { type: 'string' },
  'caller-token': { type: 'string' },
  'trust-workspace': { type: 'boolean' },
  plan: { type: 'boolean' },
  'accept-edits': { type: 'boolean' },
  'dont-ask': { type: 'boolean' },
  'allow-shell': { type: 'boolean' },
  'shell-timeout': { type: 'string' },
  'chaos-ok': { type: 'boolean' },
  capabilities: { type: 'string' },
  'enable-lsp': { type: 'boolean' },
  'test-watch': { type: 'boolean' },
  'max-cost-usd': { type: 'string' },
  'budget-input-tokens': { type: 'string' },
  'budget-output-tokens': { type: 'string' },
  'max-wall-clock-ms': { type: 'string' },
  'no-network': { type: 'boolean' },
  'trace-level': { type: 'string' },
  'research-plan': { type: 'string' },
  help: { type: 'boolean' },
});

async function main() {
  const args = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: COORDINATOR_CLI_OPTIONS,
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
  --max-steps <n>        Maximum execute-agent turns (default: runner default)
  --phases <list>        Comma-separated: research,synthesize,execute,verify
  --no-workers           Skip read-only worker subprocesses for research/verify
  --output-format <f>    text | json | stream-json (passed to execute phase)
  --session-id <id>      Canonical session id for state file

Execute-agent authority (research/verify workers remain read-only):
  --plan                 Record proposed writes as diffs; do not execute them
  --accept-edits         Skip confirmation before enabled write tools
  --dont-ask             Skip prompts for already-enabled risky tools
  --allow-shell          Expose unsandboxed bash/manage_shell_jobs
  --shell-timeout <ms>   Shell timeout (100..900000; default: 30000)
  --chaos-ok             Acknowledge shell + auto-edits + no-prompts combination
  --capabilities <list>  Optional groups: edits,recovery,agents,worktrees,skills,lsp
  --enable-lsp           Expose lsp_query to the execute agent
  --test-watch           Run detected tests after writes (requires --allow-shell)

Model and routing (inherited by workers and execute agent):
  --effort <level>       auto | low | medium | high | xhigh | max
  --thinking <mode>      auto | adaptive | off
  --temperature <f>      Model temperature when the selected model supports it
  --bridge-url <url>     Local bridge endpoint/root
  --caller-token <t>     Local caller-auth token (prefer BRIDGE_CALLER_TOKEN env)
  --trust-workspace      Record first-run consent for the target folder

Ceilings and run guards:
  --max-cost-usd <n>          Per-agent estimated cost stop
  --budget-input-tokens <n>   Shared input cap; worker use is subtracted before execute
  --budget-output-tokens <n>  Shared output cap; worker use is subtracted before execute
  --max-wall-clock-ms <n>     Shared wall-clock ceiling; execute gets remaining time
  --no-network                Best-effort network guard inherited by every agent
  --trace-level <level>       off | summary | redacted | full, inherited by every agent

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

  let cwd = path.resolve(args.values.cwd || process.cwd());
  const phases = args.values.phases
    ? args.values.phases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  if (phases && (phases.length === 0 || phases.some((phase) => !PHASES.includes(phase)))) {
    console.error('Error: --phases must contain only: ' + PHASES.join(',') + '.');
    process.exit(1);
  }
  const effectivePhases = phases || ['research', 'synthesize', 'execute'];
  if (effectivePhases.includes('verify') && !effectivePhases.includes('execute')) {
    console.error('Error: the verify phase requires execute; there is no execute result to verify otherwise.');
    process.exit(1);
  }

  const outputFormat = args.values['output-format'] || 'text';
  if (!['text', 'json', 'stream-json'].includes(outputFormat)) {
    console.error('Error: --output-format must be one of: text, json, stream-json.');
    process.exit(1);
  }

  const traceLevel = args.values['trace-level'] || 'off';
  if (!['off', 'summary', 'redacted', 'full'].includes(traceLevel)) {
    console.error('Error: --trace-level must be one of: off, summary, redacted, full.');
    process.exit(1);
  }

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

  // Turn/timeout settings must be positive integers. Parsing these centrally
  // prevents malformed coordinator commands from spending research tokens and
  // only failing when the later execute phase begins.
  const positiveInt = (name, fallback = null) => {
    const raw = args.values[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      console.error('Error: --' + name + ' must be a positive whole number.');
      process.exit(1);
    }
    return n;
  };

  const maxTokens = positiveInt('max-tokens', 2000);
  const maxSteps = positiveInt('max-steps', null);
  const shellTimeout = positiveInt('shell-timeout', 30000);
  if (shellTimeout < 100 || shellTimeout > 900000) {
    console.error('Error: --shell-timeout must be between 100 and 900000 milliseconds.');
    process.exit(1);
  }
  const maxCostUsd = num('max-cost-usd');
  const maxWallClockMs = num('max-wall-clock-ms');
  if (maxCostUsd === 0 || maxWallClockMs === 0) {
    console.error('Error: --max-cost-usd and --max-wall-clock-ms must be greater than zero when provided.');
    process.exit(1);
  }

  const allowShell = !!args.values['allow-shell'];
  const acceptEdits = !!args.values['accept-edits'];
  const dontAsk = !!args.values['dont-ask'];
  const chaosOk = !!args.values['chaos-ok'];
  if (args.values['test-watch'] && !allowShell) {
    console.error('Error: --test-watch requires --allow-shell.');
    process.exit(1);
  }
  if (allowShell && acceptEdits && dontAsk && !chaosOk) {
    console.error('Error: --allow-shell + --accept-edits + --dont-ask requires --chaos-ok.');
    process.exit(1);
  }
  const executeOnlyFlags = [
    'max-steps',
    'plan',
    'accept-edits',
    'dont-ask',
    'allow-shell',
    'shell-timeout',
    'chaos-ok',
    'capabilities',
    'enable-lsp',
    'test-watch',
  ];
  const inactiveExecuteFlags = executeOnlyFlags.filter((name) => args.values[name] !== undefined);
  if (!effectivePhases.includes('execute') && inactiveExecuteFlags.length > 0) {
    console.error(
      'Error: execute-only option(s) require the execute phase: ' +
        inactiveExecuteFlags.map((name) => '--' + name).join(', ') +
        '.',
    );
    process.exit(1);
  }

  const temperature = args.values.temperature === undefined ? null : Number(args.values.temperature);
  if (temperature !== null && (!Number.isFinite(temperature) || temperature < 0 || temperature > 1)) {
    console.error('Error: --temperature must be a number between 0 and 1.');
    process.exit(1);
  }

  let capabilities = [];
  try {
    capabilities = [...normalizeCapabilityList(args.values.capabilities)];
    resolveModelControls({
      model: args.values.model || DEFAULT_MODEL,
      effort: args.values.effort,
      thinking: args.values.thinking,
      temperature: temperature === null ? undefined : temperature,
    });
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }

  // Load the fan-out plan up front: a malformed plan should fail before any
  // worker is spawned or any token is spent.
  let researchPlan = null;
  const planPath = args.values['research-plan'];
  if (planPath) {
    if (!effectivePhases.includes('research')) {
      console.error('Error: --research-plan requires the research phase.');
      process.exit(1);
    }
    if (args.values['no-workers']) {
      console.error('Error: --research-plan cannot be used with --no-workers.');
      process.exit(1);
    }
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

  // Validate and collect consent only after every ordinary CLI/plan error has
  // been checked. A typo must never write trust state or spend model tokens.
  const cwdCheck = safety.validateCwd(cwd);
  if (!cwdCheck.valid) {
    console.error('Error: ' + cwdCheck.reason);
    process.exit(1);
  }
  const trust = await evaluateWorkspaceTrust({
    cwdRealpath: cwdCheck.realpath,
    trustWorkspace: !!args.values['trust-workspace'],
    quiet: false,
  });
  if (!trust.trusted) {
    console.error(
      'Error: workspace_not_trusted. Review the target folder, then rerun with --trust-workspace to record consent.',
    );
    process.exit(1);
  }
  cwd = cwdCheck.realpath;

  const coordinator = new Coordinator({ streamEvents: outputFormat === 'stream-json' });
  const result = await coordinator.run({
    objective,
    cwd,
    model: args.values.model || DEFAULT_MODEL,
    maxTokens,
    maxSteps,
    phases,
    useWorkers: !args.values['no-workers'],
    outputFormat,
    sessionId: args.values['session-id'],
    researchPlan,
    maxCostUsd,
    budgetInputTokens: num('budget-input-tokens'),
    budgetOutputTokens: num('budget-output-tokens'),
    maxWallClockMs,
    noNetwork: !!args.values['no-network'],
    traceLevel,
    effort: args.values.effort || null,
    thinking: args.values.thinking || null,
    temperature,
    bridgeUrl: args.values['bridge-url'] || null,
    callerToken: args.values['caller-token'] || process.env.BRIDGE_CALLER_TOKEN || null,
    inheritTrust: true,
    kernelOptions: {
      plan: !!args.values.plan,
      acceptEdits,
      dontAsk,
      allowShell,
      shellTimeout,
      chaosOk,
      capabilities,
      enableLsp: !!args.values['enable-lsp'],
      testWatch: !!args.values['test-watch'],
    },
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

module.exports = { COORDINATOR_CLI_OPTIONS, main, exitCodeForCoordinatorResult };
