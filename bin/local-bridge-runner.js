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
  --include-file <p>   Include a bounded relative file in pasted context (repeatable)\n\
  --resume <path>      Resume from a transcript (appends new prompt to existing conversation)\n\
  --accept-edits       Auto-approve write/edit/patch tools (skip confirmation)\n\
  --dont-ask           Skip confirmation for already-enabled risky tools\n\
  --allow-shell        Enable the bash tool (disabled by default)\n\
  --shell-timeout <ms> Max time for shell commands in ms (default: 30000)\n\
  --no-network         Block outbound network in shell commands (sets http_proxy=127.0.0.1:1)\n\
  --system-prompt <s>  Override the default system prompt\n\
  --allowed-tools <f>  Comma-separated tool names to enable (others hidden + denied)\n\
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
  node bin/local-bridge-runner.js --resume ~/.bridge-runner/logs/run.jsonl "Continue"\n\
  node bin/local-bridge-runner.js --accept-edits --allow-shell --dont-ask "Run npm test and fix"\n\
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
        'include-file': { type: 'string', multiple: true },
        resume: { type: 'string' },
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

  const prompt = args.positionals.join(' ').trim();
  if (!prompt) {
    console.error('Error: no prompt provided. Use --help for usage.');
    process.exit(1);
  }

  const cwd = path.resolve(args.values.cwd || process.cwd());
  const model = args.values.model || DEFAULT_MODEL;
  const maxTokens = parseInt(args.values['max-tokens'], 10) || DEFAULT_MAX_TOKENS;
  const maxSteps = parseInt(args.values['max-steps'], 10) || DEFAULT_MAX_STEPS;
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
  const acceptEdits = !!args.values['accept-edits'];
  const dontAsk = !!args.values['dont-ask'];
  const allowShell = !!args.values['allow-shell'];
  const shellTimeout = parseInt(args.values['shell-timeout'], 10) || 30000;
  const outputFormat = args.values['output-format'] || 'text';
  const stream = !!args.values.stream;
  const includeFiles = args.values['include-file'] || [];
  const noNetwork = !!args.values['no-network'];
  const systemPromptOverride = args.values['system-prompt'] || undefined;
  const plan = !!args.values.plan;
  const temperatureStr = args.values.temperature;
  const temperature = temperatureStr ? parseFloat(temperatureStr) : undefined;
  const confirmTimeout = parseInt(args.values['confirm-timeout'], 10) || undefined;
  const maxContextTokens = parseInt(args.values['max-context-tokens'], 10) || undefined;
  const maxToolCallsPerTurn = parseInt(args.values['max-tool-calls-per-turn'], 10) || undefined;
  const allowedToolsRaw = args.values['allowed-tools'];
  const allowedTools = allowedToolsRaw
    ? allowedToolsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  // --continue: find the latest transcript in ~/.bridge-runner/logs/
  const shouldContinue = !!args.values.continue;

  if (!['text', 'json', 'stream-json'].includes(outputFormat)) {
    console.error('Error: --output-format must be one of: text, json, stream-json');
    process.exit(1);
  }

  // If --resume is passed, use its value as the transcript path
  const resumePath = args.values.resume;
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
  const resume = !!resumePath;

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

  await run({
    prompt,
    stdinText: pastedParts.filter(Boolean).join('\n\n') || undefined,
    cwd,
    model,
    maxTokens,
    maxSteps,
    transcriptPath,
    humanLogPath: args.values['human-log'],
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
    allowedTools,
    maxContextTokens,
    maxToolCallsPerTurn,
  });
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

module.exports = { readIncludedFiles };
