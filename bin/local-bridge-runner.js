#!/usr/bin/env node
'use strict';

/**
 * bin/local-bridge-runner.js — CLI entry point for the local bridge runner.
 *
 * Usage:
 *   node bin/local-bridge-runner.js "Explain this repo"
 *   node bin/local-bridge-runner.js --resume ./logs/last.jsonl "Continue where we left off"
 *   node bin/local-bridge-runner.js --accept-edits --stream "Fix the bug in src/app.js"
 */

const { parseArgs } = require('util');
const fs = require('fs');
const path = require('path');
const { run } = require('../src/runner/run');
const { applyPromptTemplates, resolvePromptTemplate } = require('../src/runner/prompt-templates');
const safety = require('../src/runner/safety');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_MAX_STEPS = 16;

function showHelp() {
  console.log(
    '\
local-bridge-runner — Coding agent runner on top of claude-local-bridge\n\
\n\
Usage:\n\
  node bin/local-bridge-runner.js [options] <prompt>\n\
\n\
Options:\n\
  --cwd <path>         Working directory (default: current directory)\n\
  --model <model>      Model name (default: ' +
      DEFAULT_MODEL +
      ')\n\
  --max-tokens <n>     Max tokens per request (default: ' +
      DEFAULT_MAX_TOKENS +
      ')\n\
  --max-steps <n>      Max tool loops (default: ' +
      DEFAULT_MAX_STEPS +
      ')\n\
  --transcript <path>  JSONL transcript path (default: ~/.bridge-runner/logs/<ts>.jsonl)\n\
  --human-log <path>   Plain-text readable log path (off by default)\n\
  --trace-level <l>    Flight recorder: off, summary, redacted, or full\n\
  --trace-path <path>  Runner trace JSONL path (bridge trace is correlated separately)\n\
  --caller-token <t>   Local bridge caller auth token (or BRIDGE_CALLER_TOKEN env)\n\
  --include-file <p>   Include a bounded relative file in pasted context (repeatable)\n\
  --prompt-template <n> Prepend reusable prompt template: review, cleanup, explore, or a Markdown path\n\
  --template <n>        Alias for --prompt-template\n\
  --resume <path>      Resume from a transcript (appends new prompt to existing conversation)\n\
  --session-id <id>    Canonical session id (*.state.json under ~/.bridge-runner/sessions/)\n\
  --session-path <p>   Explicit path to session state JSON file\n\
  --resume-session     Resume from session store (--session-id or --session-path required)\n\
  --new-session        Force a fresh session (ignore --resume / --continue)\n\
  --ack-resume-risk    Allow resume even when session health is degraded\n\
  --fork-from <id>     Fork an existing session to a new session id/path\n\
  --task-scope         Task-scoped preset: tighter steps + compaction (see playbook)\n\
  --compact-each-turn  Aggressive compaction preset (compact-after-task UX)\n\
  --effort <level>     Model effort: low, medium, high, or max (runner path only)\n\
  --auto-memory        Opt-in runner auto-memory in context (default off)\n\
  --trusted-workspace  Enable hooks from .bridge-runner/hooks.json in cwd\n\
  --trust-workspace    Record trust consent for cwd (required in CI/non-interactive)\n\
  --chaos-ok           Allow risky flag combo: --allow-shell --accept-edits --dont-ask\n\
  --max-wall-clock-ms <n> Stop after N milliseconds\n\
  --max-cost-usd <n>    Stop after estimated cost exceeds N USD\n\
  --agent <profile>     Runner personality: explore, plan, implement, verify, test, project, …\n\
  --list-agents         List built-in runner personalities and exit\n\
  --bare                Minimal context: no instruction docs, repo block, or skills\n\
  --include-instruction-docs  Opt in to AGENTS.md / CLAUDE.md instruction hierarchy\n\
  --include-repo-context      Opt in to session repo-context block (fingerprint)\n\
  --include-claude-md         Include CLAUDE.md inside repo-context (requires --include-repo-context)\n\
  --include-repo-map          Opt in to repo map inside repo-context block\n\
  --include-skills            Opt in to skills listing in system prompt\n\
  --append-system-prompt <s>  Append text to the default system prompt\n\
  --append-system-prompt-file <p>  Append contents of a file to the system prompt\n\
  --system-prompt-file <p>    Replace default system prompt with file contents\n\
  --exclude-dynamic-system-prompt-sections  Put cwd/git fingerprint in first user message\n\
  --permission-mode <m>   default | plan | accept-edits | dont-ask | accept-edits-dont-ask | auto\n\
  --tools <names>         Comma-separated tools to expose; include apply_patch to opt into patch mode\n\
  --no-session-persistence    Do not write session checkpoints to ~/.bridge-runner/sessions/\n\
  --review-memory       List pending memory promotions for approval\n\
  --session-extract     Run background session extraction after completion\n\
  --no-archive          Skip writing per-turn archive under ~/.bridge-runner/archive/\n\
  --accept-edits       Auto-approve write/edit/patch tools (skip confirmation)\n\
  --dont-ask           Skip confirmation for already-enabled risky tools\n\
  --allow-shell        Enable the bash tool (disabled by default)\n\
  --shell-timeout <ms> Max time for shell commands in ms (default: 30000)\n\
  --no-network         Best-effort HTTP/HTTPS proxy guard for shell commands; not a sandbox\n\
  --system-prompt <s>  Override the default system prompt\n\
  --allowed-tools <f>  Same as --tools (others hidden + denied)\n\
  --max-context-tokens <n> Warn when total tokens exceed budget; halt at 2x budget\n\
  --max-tool-calls-per-turn <n> Cap tool calls per model response; halt if exceeded\n\
  --temperature <f>    Model temperature 0.0–1.0 (default: model default, usually 1.0)\n\
  --confirm-timeout <ms> Auto-deny confirmation prompts after N ms (default: no timeout)\n\
  --log-level <level>  Stderr verbosity: quiet, normal, or verbose (default: normal)\n\
  --continue           Resume from the latest transcript in ~/.bridge-runner/logs/\n\
  --plan               Plan mode: describe actions instead of executing them\n\
  --output-format <f>  Output style: text, json, or stream-json (default: text)\n\
  --stream             Stream model output live to terminal as it arrives\n\
  --verbose            Print step-by-step progress to stderr\n\
  --help               Show this help\n\
\n\
Examples:\n\
  node bin/local-bridge-runner.js "Explain this repo"\n\
  node bin/local-bridge-runner.js --cwd /path/to/project "Summarize that project"\n\
  node bin/local-bridge-runner.js --cwd /path/to/project --include-file README.md "Review the README"\n\
  node bin/local-bridge-runner.js --stream "List and explain src/server.js"\n\
  node bin/local-bridge-runner.js --plan --allowed-tools list_files,read_file "Inspect before changing anything"\n\
  node bin/local-bridge-runner.js --resume ~/.bridge-runner/logs/run.jsonl "Continue"\n\
  node bin/local-bridge-runner.js --accept-edits --allow-shell --dont-ask "Run npm test and fix"\n\
\n\
Beginner notes:\n\
  Type the command in Terminal after the local bridge is running.\n\
  Start with --plan or read-only tools while you learn what a prompt will do.\n\
  --accept-edits allows file changes. --allow-shell exposes bash commands.\n\
  --dont-ask only skips prompts for tools you already enabled; it does not enable bash by itself.\n\
  apply_patch is hidden by default; use --tools apply_patch only when patch-mode edits are needed.\n\
  redacted/full traces are local files that can contain prompts and source-code details.\n\
',
  );
}

async function main() {
  let args;
  try {
    args = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        cwd: { type: 'string' },
        model: { type: 'string' },
        'max-tokens': { type: 'string' },
        'max-steps': { type: 'string' },
        transcript: { type: 'string' },
        'human-log': { type: 'string' },
        'trace-level': { type: 'string' },
        'trace-path': { type: 'string' },
        'caller-token': { type: 'string' },
        'include-file': { type: 'string', multiple: true },
        'prompt-template': { type: 'string', multiple: true },
        template: { type: 'string', multiple: true },
        resume: { type: 'string' },
        'session-id': { type: 'string' },
        'session-path': { type: 'string' },
        'resume-session': { type: 'boolean' },
        'new-session': { type: 'boolean' },
        'ack-resume-risk': { type: 'boolean' },
        'fork-from': { type: 'string' },
        'task-scope': { type: 'boolean' },
        'compact-each-turn': { type: 'boolean' },
        effort: { type: 'string' },
        'auto-memory': { type: 'boolean' },
        'trusted-workspace': { type: 'boolean' },
        'trust-workspace': { type: 'boolean' },
        'chaos-ok': { type: 'boolean' },
        'max-wall-clock-ms': { type: 'string' },
        'max-cost-usd': { type: 'string' },
        agent: { type: 'string' },
        'list-agents': { type: 'boolean' },
        bare: { type: 'boolean' },
        'include-instruction-docs': { type: 'boolean' },
        'include-repo-context': { type: 'boolean' },
        'include-claude-md': { type: 'boolean' },
        'include-repo-map': { type: 'boolean' },
        'include-skills': { type: 'boolean' },
        'append-system-prompt': { type: 'string' },
        'append-system-prompt-file': { type: 'string' },
        'system-prompt-file': { type: 'string' },
        'exclude-dynamic-system-prompt-sections': { type: 'boolean' },
        'permission-mode': { type: 'string' },
        tools: { type: 'string' },
        'no-session-persistence': { type: 'boolean' },
        replay: { type: 'boolean' },
        repair: { type: 'boolean' },
        'review-memory': { type: 'boolean' },
        'session-extract': { type: 'boolean' },
        'no-archive': { type: 'boolean' },
        'accept-edits': { type: 'boolean' },
        'dont-ask': { type: 'boolean' },
        'allow-shell': { type: 'boolean' },
        'shell-timeout': { type: 'string' },
        'output-format': { type: 'string' },
        'no-network': { type: 'boolean' },
        'system-prompt': { type: 'string' },
        'allowed-tools': { type: 'string' },
        'max-context-tokens': { type: 'string' },
        'max-tool-calls-per-turn': { type: 'string' },
        temperature: { type: 'string' },
        'confirm-timeout': { type: 'string' },
        'log-level': { type: 'string' },
        continue: { type: 'boolean' },
        plan: { type: 'boolean' },
        stream: { type: 'boolean' },
        verbose: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch (err) {
    console.error('Error parsing arguments: ' + err.message);
    process.exit(1);
  }

  if (args.values.help) {
    showHelp();
    process.exit(0);
  }

  if (args.values['list-agents']) {
    const { formatAgentList } = require('../src/runner/agents/registry');
    console.log(formatAgentList());
    process.exit(0);
  }

  let prompt = args.positionals.join(' ').trim();

  if (args.values['review-memory']) {
    const { formatReviewSummary } = require('../src/runner/memory-review');
    console.log(formatReviewSummary(path.resolve(args.values.cwd || process.cwd())));
    process.exit(0);
  }

  if (args.values.replay) {
    const { resolveSessionPath } = require('../src/runner/session-store');
    const { replayFromLedger } = require('../src/runner/replay-simulator');
    const sp = resolveSessionPath({ sessionPath: args.values['session-path'], sessionId: args.values['session-id'] });
    if (!sp) {
      console.error('Error: --replay requires --session-id or --session-path');
      process.exit(1);
    }
    console.log(JSON.stringify(replayFromLedger(sp), null, 2));
    process.exit(0);
  }

  if (args.values.repair) {
    const { resolveSessionPath } = require('../src/runner/session-store');
    const { planRepair, applyRepair } = require('../src/runner/ledger-repair');
    const sp = resolveSessionPath({ sessionPath: args.values['session-path'], sessionId: args.values['session-id'] });
    if (!sp) {
      console.error('Error: --repair requires --session-id or --session-path');
      process.exit(1);
    }
    const plan = planRepair(sp);
    console.log(JSON.stringify(applyRepair(sp, plan.repairPlan, false), null, 2));
    process.exit(0);
  }

  if (!prompt && !args.values.help) {
    console.error('Error: no prompt provided. Use --help for usage.');
    process.exit(1);
  }

  if (!prompt) {
    showHelp();
    process.exit(0);
  }

  const cwd = path.resolve(args.values.cwd || process.cwd());
  const promptTemplateNames = [...(args.values['prompt-template'] || []), ...(args.values.template || [])];
  if (promptTemplateNames.length > 0) {
    try {
      const templates = promptTemplateNames.map((name) => resolvePromptTemplate(cwd, name));
      prompt = applyPromptTemplates(prompt, templates);
    } catch (err) {
      console.error('Error: ' + err.message);
      process.exit(1);
    }
  }
  const model = args.values.model || DEFAULT_MODEL;
  let maxTokens = parseInt(args.values['max-tokens'], 10) || DEFAULT_MAX_TOKENS;
  let maxSteps = parseInt(args.values['max-steps'], 10) || DEFAULT_MAX_STEPS;
  const verboseFromFlag = !!args.values.verbose;
  const logLevel = args.values['log-level'];
  if (logLevel && !['quiet', 'normal', 'verbose'].includes(logLevel)) {
    console.error('Error: --log-level must be one of: quiet, normal, verbose');
    process.exit(1);
  }
  // --verbose flag is equivalent to --log-level verbose; log-level takes precedent
  const effectiveLogLevel = logLevel || (verboseFromFlag ? 'verbose' : 'normal');
  const verbose = effectiveLogLevel === 'verbose';
  const quiet = effectiveLogLevel === 'quiet';
  const { normalizePermissionMode, applyPermissionMode } = require('../src/runner/permission-mode');
  let permDefaults = { acceptEdits: false, dontAsk: false, plan: false, allowShell: false };
  if (args.values['permission-mode']) {
    try {
      const modeName = normalizePermissionMode(args.values['permission-mode']);
      permDefaults = applyPermissionMode(permDefaults, modeName);
    } catch (err) {
      console.error('Error: ' + err.message);
      process.exit(1);
    }
  }
  const acceptEdits = args.values['accept-edits'] ? true : permDefaults.acceptEdits;
  const dontAsk = args.values['dont-ask'] ? true : permDefaults.dontAsk;
  const allowShell = args.values['allow-shell'] ? true : permDefaults.allowShell;
  const shellTimeout = parseInt(args.values['shell-timeout'], 10) || 30000;
  const outputFormat = args.values['output-format'] || 'text';
  const traceLevel = args.values['trace-level'] || 'off';
  const callerToken = args.values['caller-token'] || process.env.BRIDGE_CALLER_TOKEN || '';
  if (!['off', 'summary', 'redacted', 'full'].includes(traceLevel)) {
    console.error('Error: --trace-level must be one of: off, summary, redacted, full');
    process.exit(1);
  }
  const stream = !!args.values.stream;
  const includeFiles = args.values['include-file'] || [];
  const noNetwork = !!args.values['no-network'];
  const systemPromptOverride = args.values['system-prompt'] || undefined;
  const plan = args.values.plan ? true : permDefaults.plan;
  const temperatureStr = args.values.temperature;
  const temperature = temperatureStr ? parseFloat(temperatureStr) : undefined;
  const confirmTimeout = parseInt(args.values['confirm-timeout'], 10) || undefined;
  const maxContextTokens = parseInt(args.values['max-context-tokens'], 10) || undefined;
  const maxToolCallsPerTurn = parseInt(args.values['max-tool-calls-per-turn'], 10) || undefined;
  const toolsRaw = args.values.tools || args.values['allowed-tools'];
  const exposedTools = toolsRaw
    ? toolsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  // --continue: find the latest transcript in ~/.bridge-runner/logs/
  const shouldContinue = !!args.values.continue;
  const newSession = !!args.values['new-session'];
  const resumeSession = !!args.values['resume-session'];
  const ackResumeRisk = !!args.values['ack-resume-risk'];
  const taskScope = !!args.values['task-scope'];
  const compactEachTurn = !!args.values['compact-each-turn'];
  const effortRaw = args.values.effort;
  const autoMemory = !!args.values['auto-memory'];

  let sessionId = args.values['session-id'];
  let sessionPath = args.values['session-path'];
  const forkFrom = args.values['fork-from'];

  if (effortRaw) {
    const { normalizeEffort } = require('../src/runner/run');
    try {
      normalizeEffort(effortRaw);
    } catch (err) {
      console.error('Error: ' + err.message);
      process.exit(1);
    }
  }

  if (forkFrom) {
    const { SessionStore, resolveSessionPath, makeSessionId } = require('../src/runner/session-store');
    const parentPath = resolveSessionPath({ sessionId: forkFrom });
    if (!parentPath || !fs.existsSync(parentPath)) {
      console.error('Error: --fork-from session not found: ' + forkFrom);
      process.exit(1);
    }
    if (!sessionId && !sessionPath) {
      sessionId = makeSessionId();
    }
    const childPath = resolveSessionPath({ sessionPath, sessionId });
    const parentStore = new SessionStore(parentPath);
    parentStore.load();
    parentStore.fork(childPath);
    sessionPath = childPath;
    sessionId = path.basename(childPath, '.state.json');
    console.error('[runner] forked session to ' + childPath);
  }

  let compactionPolicy;
  if (taskScope) {
    if (!args.values['max-steps']) maxSteps = 8;
    compactionPolicy = {
      warnTokens: 40_000,
      haltTokens: 80_000,
      snipAfterMessages: 12,
      ghostAfterMessages: 20,
      maxToolResultChars: 8_000,
    };
  }
  if (compactEachTurn) {
    compactionPolicy = {
      ...(compactionPolicy || {}),
      warnTokens: 20_000,
      haltTokens: 40_000,
      snipAfterMessages: 6,
      ghostAfterMessages: 10,
      maxToolResultChars: 4_000,
    };
  }

  if (!['text', 'json', 'stream-json'].includes(outputFormat)) {
    console.error('Error: --output-format must be one of: text, json, stream-json');
    process.exit(1);
  }

  // If --resume is passed, use its value as the transcript path
  let resumePath = args.values.resume;
  const explicitTranscript = args.values.transcript;

  let transcriptPath;
  if (explicitTranscript) {
    transcriptPath = explicitTranscript;
  } else if (resumePath) {
    transcriptPath = resumePath;
  } else {
    const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    const logDir = path.join(homeDir, '.bridge-runner', 'logs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    transcriptPath = path.join(logDir, timestamp + '.jsonl');
  }

  // --continue: find the latest transcript automatically
  if (shouldContinue && !resumePath) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
    const logDir = path.join(homeDir, '.bridge-runner', 'logs');
    try {
      const files = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort();
      if (files.length === 0) {
        console.error('[runner] --continue: no transcripts found in ' + logDir + '. Starting a new session.');
        resumePath = null;
      } else {
        resumePath = path.join(logDir, files[files.length - 1]);
        transcriptPath = resumePath;
        console.error('[runner] continuing from ' + resumePath);
      }
    } catch {
      console.error('[runner] --continue: cannot access ' + logDir + '. Starting a new session.');
      resumePath = null;
    }
  }

  // When resuming, the transcript is reused; we append new events to it
  let resume = false;
  if (newSession) {
    resume = false;
    resumePath = null;
    if (!sessionId && !sessionPath) {
      const { makeSessionId } = require('../src/runner/session-store');
      sessionId = makeSessionId();
      console.error('[runner] new session id: ' + sessionId);
    }
  } else if (resumeSession) {
    if (!sessionId && !sessionPath) {
      console.error('Error: --resume-session requires --session-id or --session-path');
      process.exit(1);
    }
    resume = true;
  } else if (resumePath) {
    resume = true;
  }

  // Read stdin if piped
  const pastedParts = [];
  if (!process.stdin.isTTY) {
    try {
      pastedParts.push(fs.readFileSync(process.stdin.fd, 'utf8'));
    } catch {
      // ignore — stdin may not be readable
    }
  }

  if (includeFiles.length > 0) {
    pastedParts.push(readIncludedFiles(cwd, includeFiles));
  }

  printRuntimeTips({
    cwd,
    quiet,
    plan,
    acceptEdits,
    dontAsk,
    allowShell,
    noNetwork,
    exposedTools,
    allowedTools: exposedTools,
    outputFormat,
    traceLevel,
  });

  await run({
    prompt,
    stdinText: pastedParts.filter(Boolean).join('\n\n') || undefined,
    cwd,
    model,
    maxTokens,
    maxSteps,
    transcriptPath,
    humanLogPath: args.values['human-log'],
    traceLevel,
    tracePath: args.values['trace-path'],
    callerToken,
    verbose,
    quiet,
    acceptEdits,
    dontAsk,
    allowShell,
    shellTimeout,
    outputFormat,
    resume,
    stream,
    noNetwork,
    systemPromptOverride,
    plan,
    temperature,
    confirmTimeout,
    exposedTools,
    allowedTools: exposedTools,
    maxContextTokens,
    maxToolCallsPerTurn,
    sessionId,
    sessionPath,
    compactionPolicy,
    ackResumeRisk,
    newSession,
    taskScope,
    effort: effortRaw,
    autoMemory,
    trustedWorkspace: !!args.values['trusted-workspace'],
    trustWorkspace: !!args.values['trust-workspace'],
    chaosOk: !!args.values['chaos-ok'],
    maxWallClockMs: parseInt(args.values['max-wall-clock-ms'], 10) || undefined,
    maxCostUsd: parseFloat(args.values['max-cost-usd']) || undefined,
    agentProfile: args.values.agent || undefined,
    sessionExtract: !!args.values['session-extract'],
    skipTrustGate: process.env.BRIDGE_RUNNER_TEST === '1' && !args.values['trust-workspace'],
    noArchive: !!args.values['no-archive'],
    bare: !!args.values.bare,
    includeInstructionDocs: !!args.values['include-instruction-docs'],
    includeRepoContext: !!args.values['include-repo-context'],
    includeClaudeMdInRepoContext: !!args.values['include-claude-md'],
    includeRepoMap: !!args.values['include-repo-map'],
    includeSkills: !!args.values['include-skills'],
    appendSystemPrompt: args.values['append-system-prompt'] || undefined,
    appendSystemPromptFile: args.values['append-system-prompt-file'] || undefined,
    systemPromptFile: args.values['system-prompt-file'] || undefined,
    excludeDynamicFromSystem: !!args.values['exclude-dynamic-system-prompt-sections'],
    noSessionPersistence: !!args.values['no-session-persistence'],
    exposedTools,
  });
}

function printRuntimeTips(options) {
  if (options.quiet) return;

  console.error('[runner] target project folder: ' + options.cwd);
  if (options.plan) {
    console.error('[runner] tip: plan mode inspects first and returns dry-run tool results for proposed actions.');
  } else if (!options.acceptEdits && !options.allowShell) {
    console.error('[runner] tip: this starts conservatively; edits ask for approval and bash stays hidden.');
  }

  if (options.acceptEdits) {
    console.error('[runner] warning: --accept-edits lets the model change files without a write confirmation.');
  }
  if (options.allowShell) {
    console.error('[runner] warning: --allow-shell exposes bash. Read the proposed command before approving it.');
  } else if (options.dontAsk) {
    console.error('[runner] tip: --dont-ask does not enable bash. Add --allow-shell only when shell access is needed.');
  }
  if (options.noNetwork) {
    console.error('[runner] warning: --no-network is a best-effort shell proxy guard, not a network sandbox.');
  }
  if (options.allowedTools) {
    console.error('[runner] tip: only these tools are visible: ' + options.allowedTools.join(', ') + '.');
  }
  if (options.outputFormat !== 'text') {
    console.error('[runner] tip: machine-readable output stays on stdout; runner tips and warnings stay on stderr.');
  }
  if (options.traceLevel && options.traceLevel !== 'off') {
    console.error('[runner] tip: flight-recorder traces stay local; treat redacted/full traces as sensitive.');
  }
}

function readIncludedFiles(cwd, includeFiles) {
  const cwdCheck = safety.validateCwd(cwd);
  if (!cwdCheck.valid) {
    throw new Error(cwdCheck.reason);
  }

  const ctx = { cwd, cwdRealpath: cwdCheck.realpath };
  const sections = [];
  for (const inputPath of includeFiles) {
    const target = safety.confinePath(ctx, inputPath);
    if (!target) {
      throw new Error('--include-file escapes cwd: ' + inputPath);
    }
    if (safety.isPathBlockedByDenyMatrix(target)) {
      throw new Error('--include-file is blocked by safety rules: ' + inputPath);
    }
    const stat = fs.statSync(target);
    if (!stat.isFile()) {
      throw new Error('--include-file is not a file: ' + inputPath);
    }
    if (stat.size > 50 * 1024) {
      throw new Error('--include-file is too large: ' + inputPath + ' (' + stat.size + ' bytes, max 51200)');
    }
    const content = safety.scrubSecrets(fs.readFileSync(target, 'utf8'));
    sections.push('Included file: ' + inputPath + '\n---\n' + content);
  }
  return sections.join('\n\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unexpected error: ' + err.message);
    if (process.exitCode === undefined) process.exitCode = 1;
  });
}

module.exports = { printRuntimeTips, readIncludedFiles };
