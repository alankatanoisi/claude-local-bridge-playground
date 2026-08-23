#!/usr/bin/env node
'use strict';

/**
 * bin/local-bridge-acp.js — ACP (Agent Client Protocol) entry point for the
 * bridge runner.
 *
 * A client such as T3 Code spawns this process and speaks newline-delimited
 * JSON-RPC 2.0 with it over stdin/stdout. Every flag here is a PER-INSTANCE
 * DEFAULT (set once where the client registers the agent command); the
 * per-session composer controls come from ACP config options instead.
 *
 * Usage (what a client's agent-command setting would contain):
 *   node bin/local-bridge-acp.js
 *   node bin/local-bridge-acp.js --model claude-haiku-4-5 --effort low
 *   node bin/local-bridge-acp.js --capabilities edits --trust-workspace
 *   node bin/local-bridge-acp.js --allow-shell        # the ONLY way to expose shell
 */

// ── stdout guard ────────────────────────────────────────────────────────────
// In an ACP process, standard output IS the protocol channel: one stray text
// line corrupts the JSON-RPC stream. The runner legitimately prints things
// (run.js writes the final answer with console.log in text mode), so instead
// of chasing every print site, we capture the real stdout writer for protocol
// frames and send every other stdout write to stderr, which ACP leaves free
// for diagnostics. This must happen before any other require can print.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => process.stderr.write(chunk, encoding, callback);

const { parseArgs } = require('util');
const fs = require('fs');
const path = require('path');

const { run } = require('../src/runner/run');
const { createAcpAgent, MODEL_CHOICES } = require('../src/runner/acp/agent');
const { EFFORT_LEVELS, EFFORT_AUTO } = require('../src/runner/model-catalog');
const { OPTIONAL_CAPABILITIES } = require('../src/runner/tool-catalog');
// Reused from the terminal runner so the two entry points cannot drift on how
// a bridge URL is normalized. Requiring it does not execute its main() — that
// is gated behind require.main === module.
const { resolveBridgeUrl } = require('./local-bridge-runner');

function showHelp() {
  // Deliberately stderr: stdout carries protocol frames only.
  console.error(
    [
      'local-bridge-acp — bridge runner as an ACP stdio agent',
      '',
      'All flags are per-instance defaults; per-session values come from ACP config options.',
      '',
      '  --model <id>           default model (' + MODEL_CHOICES.join(', ') + ')',
      '  --effort <level>       default reasoning effort (' + [EFFORT_AUTO, ...EFFORT_LEVELS].join(', ') + ')',
      '  --max-tokens <n>       default per-turn token budget (default 2000)',
      '  --capabilities <list>  comma-separated groups enabled by default (' + OPTIONAL_CAPABILITIES.join(', ') + ')',
      '  --bridge-url <url>     local bridge address (default from BRIDGE_RUNNER_BRIDGE_URL or 127.0.0.1:11437)',
      '  --session-dir <path>   where session checkpoints live (default ~/.bridge-runner/sessions)',
      '  --trust-workspace      record workspace trust for session cwds (headless processes cannot',
      '                         answer the interactive trust prompt; without this, an untrusted cwd fails closed)',
      '  --allow-shell          expose the shell capability group (the singular consent flag;',
      '                         never exposed as a composer toggle)',
      '  --help                 this text',
    ].join('\n'),
  );
}

function main() {
  const args = parseArgs({
    options: {
      model: { type: 'string' },
      effort: { type: 'string' },
      'max-tokens': { type: 'string' },
      capabilities: { type: 'string' },
      'bridge-url': { type: 'string' },
      'session-dir': { type: 'string' },
      'trust-workspace': { type: 'boolean' },
      'allow-shell': { type: 'boolean' },
      help: { type: 'boolean' },
    },
    // ACP hosts launch their agent as "<binary> acp" (a subcommand token).
    // We accept and ignore positionals so that invocation shape works both
    // through the T3 shim and directly.
    allowPositionals: true,
  });

  if (args.values.help) {
    showHelp();
    return;
  }

  const effort = args.values.effort;
  if (effort && effort !== EFFORT_AUTO && !EFFORT_LEVELS.includes(effort)) {
    console.error('--effort must be one of: ' + [EFFORT_AUTO, ...EFFORT_LEVELS].join(', '));
    process.exitCode = 1;
    return;
  }

  const maxTokens = args.values['max-tokens'] ? parseInt(args.values['max-tokens'], 10) : undefined;
  if (args.values['max-tokens'] && (!Number.isFinite(maxTokens) || maxTokens <= 0)) {
    console.error('--max-tokens must be a positive integer');
    process.exitCode = 1;
    return;
  }

  const capabilityDefaults = {};
  if (args.values.capabilities) {
    for (const raw of args.values.capabilities.split(',')) {
      const group = raw.trim();
      if (!group) continue;
      if (!OPTIONAL_CAPABILITIES.includes(group)) {
        console.error('--capabilities: unknown group "' + group + '" (valid: ' + OPTIONAL_CAPABILITIES.join(', ') + ')');
        process.exitCode = 1;
        return;
      }
      capabilityDefaults[group] = true;
    }
  }

  let version = '0.0.0';
  try {
    version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || version;
  } catch {
    // agentInfo.version is cosmetic; never fail startup over it
  }

  const bridgeUrl = resolveBridgeUrl(args.values, process.env);

  createAcpAgent({
    input: process.stdin,
    write: (line) => realStdoutWrite(line),
    runFn: run,
    sessionDir: args.values['session-dir'],
    version,
    configDefaults: {
      model: args.values.model,
      effort,
      maxTokens,
      capabilities: capabilityDefaults,
    },
    runDefaults: {
      ...(bridgeUrl ? { bridgeUrl } : {}),
      ...(args.values['trust-workspace'] ? { trustWorkspace: true } : {}),
      ...(args.values['allow-shell'] ? { allowShell: true } : {}),
    },
  });

  // An ACP agent is a long-lived subprocess: it serves requests until the
  // client closes its stdin, then exits cleanly.
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

if (require.main === module) {
  main();
}

module.exports = { main };
