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
  --resume <path>      Resume from a transcript (appends new prompt to existing conversation)\n\
  --accept-edits       Auto-approve write/edit/patch tools (skip confirmation)\n\
  --dont-ask           Auto-approve shell commands (skip confirmation)\n\
  --allow-shell        Enable the bash tool (disabled by default)\n\
  --shell-timeout <ms> Max time for shell commands in ms (default: 30000)\n\
  --stream             Stream model output live to terminal as it arrives\n\
  --verbose            Print step-by-step progress to stderr\n\
  --help               Show this help\n\
\n\
Examples:\n\
  node bin/local-bridge-runner.js "Explain this repo"\n\
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
        resume: { type: 'string' },
        'accept-edits': { type: 'boolean' },
        'dont-ask': { type: 'boolean' },
        'allow-shell': { type: 'boolean' },
        'shell-timeout': { type: 'string' },
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
  const verbose = !!args.values.verbose;
  const acceptEdits = !!args.values['accept-edits'];
  const dontAsk = !!args.values['dont-ask'];
  const allowShell = !!args.values['allow-shell'];
  const shellTimeout = parseInt(args.values['shell-timeout'], 10) || 30000;
  const stream = !!args.values.stream;

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

  // When resuming, the transcript is reused; we append new events to it
  const resume = !!resumePath;

  // Read stdin if piped
  let stdinText = '';
  if (!process.stdin.isTTY) {
    try {
      stdinText = fs.readFileSync(process.stdin.fd, 'utf8');
    } catch {
      // ignore — stdin may not be readable
    }
  }

  await run({
    prompt,
    stdinText: stdinText || undefined,
    cwd,
    model,
    maxTokens,
    maxSteps,
    transcriptPath,
    verbose,
    acceptEdits,
    dontAsk,
    allowShell,
    shellTimeout,
    resume,
    stream,
  });
}

main().catch((err) => {
  console.error('Unexpected error: ' + err.message);
  if (process.exitCode === undefined) process.exitCode = 1;
});
