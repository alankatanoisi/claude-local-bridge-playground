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
const { createAcpAgent, MODEL_CHOICES, DEFAULT_ACP_MAX_STEPS } = require('../src/runner/acp/agent');
const { EFFORT_LEVELS, EFFORT_AUTO } = require('../src/runner/model-catalog');
const { OPTIONAL_CAPABILITIES } = require('../src/runner/tool-catalog');
// Reused from the terminal runner so the two entry points cannot drift on how
// a bridge URL is normalized. Requiring it does not execute its main() — that
// is gated behind require.main === module.
const { resolveBridgeUrl } = require('./local-bridge-runner');
const { validateHost, createHostManager } = require('../src/hosting/ensure');

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
      '  --max-steps <n>        tool-step ceiling per turn (default ' +
        DEFAULT_ACP_MAX_STEPS +
        '; the CLI runner default of 16 is too low for an open-ended chat)',
      '  --capabilities <list>  comma-separated groups enabled by default (' + OPTIONAL_CAPABILITIES.join(', ') + ')',
      '  --bridge-url <url>     local bridge address (default from BRIDGE_RUNNER_BRIDGE_URL or 127.0.0.1:11437)',
      '  --bridge-host <host>   opt in to per-chat host selection (standalone, desktop, browser, vscode)',
      '                         managed hosts start on prompt submission; vscode is connect-only',
      '                         default also accepts BRIDGE_RUNNER_HOST; conflicts with a fixed bridge URL',
      '                         BRIDGE_RUNNER_VSCODE_URL may override only the existing/debug endpoint',
      '                         BRIDGE_CALLER_TOKEN supplies optional local caller auth (never upstream auth)',
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
      'max-steps': { type: 'string' },
      capabilities: { type: 'string' },
      'bridge-url': { type: 'string' },
      'bridge-host': { type: 'string' },
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

  const maxSteps = args.values['max-steps'] ? parseInt(args.values['max-steps'], 10) : undefined;
  if (args.values['max-steps'] && (!Number.isFinite(maxSteps) || maxSteps <= 0)) {
    console.error('--max-steps must be a positive integer');
    process.exitCode = 1;
    return;
  }

  const capabilityDefaults = {};
  if (args.values.capabilities) {
    for (const raw of args.values.capabilities.split(',')) {
      const group = raw.trim();
      if (!group) continue;
      if (!OPTIONAL_CAPABILITIES.includes(group)) {
        console.error(
          '--capabilities: unknown group "' + group + '" (valid: ' + OPTIONAL_CAPABILITIES.join(', ') + ')',
        );
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

  const bridgeHost = args.values['bridge-host'] || process.env.BRIDGE_RUNNER_HOST;
  if (bridgeHost) {
    validateHost(bridgeHost);
    if (args.values['bridge-url'] || process.env.BRIDGE_RUNNER_BRIDGE_URL) {
      throw new Error(
        'Choose --bridge-host OR a fixed bridge URL. Remove --bridge-url and BRIDGE_RUNNER_BRIDGE_URL to use the host selector.',
      );
    }
  }
  const bridgeUrl = bridgeHost ? undefined : resolveBridgeUrl(args.values, process.env);

  createAcpAgent({
    input: process.stdin,
    write: (line) => realStdoutWrite(line),
    runFn: run,
    sessionDir: args.values['session-dir'],
    version,
    ...(bridgeHost
      ? { hostManager: createHostManager(undefined, { vscodeUrl: process.env.BRIDGE_RUNNER_VSCODE_URL }) }
      : {}),
    configDefaults: {
      ...(bridgeHost ? { bridgeHost } : {}),
      model: args.values.model,
      effort,
      maxTokens,
      capabilities: capabilityDefaults,
    },
    runDefaults: {
      ...(process.env.BRIDGE_CALLER_TOKEN ? { callerToken: process.env.BRIDGE_CALLER_TOKEN } : {}),
      ...(bridgeUrl ? { bridgeUrl } : {}),
      ...(args.values['trust-workspace'] ? { trustWorkspace: true } : {}),
      ...(args.values['allow-shell'] ? { allowShell: true } : {}),
      ...(maxSteps ? { maxSteps } : {}),
    },
  });

  // An ACP agent is a long-lived subprocess: it serves requests until the
  // client closes its stdin, then exits cleanly.
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // A concise message is useful in T3; raw parser output and stacks are not.
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
