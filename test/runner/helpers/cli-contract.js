'use strict';

/**
 * cli-contract.js — shared "does the real CLI accept this?" helpers for the
 * command-builder sweeps (V1 docs/command-builder.html and V2
 * docs/command-builder-v2.html).
 *
 * Nothing here re-implements builder rules. It reads the runner's real
 * parseArgs option table out of bin/local-bridge-runner.js, tokenizes a
 * generated command the way zsh would, and re-runs the same startup
 * validators the CLI runs (chaos gate, capability list, model controls,
 * context policy). A dead-bridge spawn helper proves a command survives the
 * whole CLI startup path and fails only at transport.
 */

const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('node:util');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER_BIN = path.join(ROOT, 'bin', 'local-bridge-runner.js');

const { TOOLS, OPTIONAL_CAPABILITIES } = require('../../../src/runner/tool-catalog');
const { normalizeCapabilityList } = require('../../../src/runner/tool-visibility');
const { validateChaosCombo } = require('../../../src/runner/shell-policy');
const { resolveModelControls } = require('../../../src/runner/model-capabilities');
const { deriveContextPolicy } = require('../../../src/runner/context-runtime-policy');
const { DEFAULT_MODEL } = require('../../../src/runner/model-catalog');

// ── The runner's real option table, read from the CLI source ──
// Same extraction the docs gate (scripts/check-runner-manifest.js) relies on:
// the parseArgs `options: { … }` block is a plain object literal, so it can be
// evaluated as-is. If the block moves, this fails loudly instead of silently
// validating against nothing.
function loadRunnerCliOptions() {
  const source = fs.readFileSync(RUNNER_BIN, 'utf8');
  const block = source.match(/options:\s*\{([\s\S]*?)\n\s{6}\},/);
  assert.ok(block, 'could not find the parseArgs options block in bin/local-bridge-runner.js');
  const table = vm.runInNewContext('({' + block[1] + '})');
  assert.ok(table.cwd && table['allow-shell'], 'extracted option table looks wrong');
  return table;
}
const RUNNER_CLI_OPTIONS = loadRunnerCliOptions();

// Flags that must never come out of a builder: retired, deprecated, hidden
// (internal), or superseded by a builder control that emits the canonical form.
const NEVER_EMITTED = [
  '--resume',
  '--max-context-tokens',
  '--permission-mode',
  '--allowed-tools',
  '--template',
  '--inherit-workspace-trust',
  '--update',
  '--approve-repair',
];

// ── A small POSIX tokenizer for the builders' own quoting ──
// Both builders emit single-quoted arguments ('…', with '"'"' for an embedded
// quote) and double-quoted environment references ("$VAR"). That is the whole
// grammar, so this stays deliberately tiny.
function shellSplit(command) {
  const tokens = [];
  let current = '';
  let inToken = false;
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
      continue;
    }
    current += ch;
    inToken = true;
  }
  if (inToken) tokens.push(current);
  assert.equal(quote, null, 'unterminated quote in generated command: ' + command);
  return tokens;
}

function parseGenerated(command, options) {
  const tokens = shellSplit(command);
  assert.equal(tokens[0], 'node', 'command must start with node: ' + command);
  assert.match(tokens[1], /^bin\/local-bridge-(runner|coordinator)\.js$/);
  const args = tokens.slice(2);
  // parseArgs takes the last value for a repeated flag; a builder that emits
  // the same flag twice has a logic bug even when the CLI tolerates it.
  const seen = new Map();
  for (const token of args) {
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    if (options[name] && options[name].multiple) continue;
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([name]) => '--' + name);
  assert.deepEqual(dupes, [], 'duplicated flags in: ' + command);
  const parsed = util.parseArgs({ args, options, strict: true, allowPositionals: true });
  return { tokens, args, values: parsed.values, positionals: parsed.positionals };
}

// Invariants the runner CLI enforces at startup (bin/local-bridge-runner.js).
// Each generated, unblocked command must satisfy them or the CLI would refuse.
function assertRunnerInvariants(parsed, command, { prompt } = {}) {
  const v = parsed.values;
  if (prompt !== undefined) {
    assert.deepEqual(parsed.positionals, [prompt], 'exactly one positional (the prompt): ' + command);
  } else {
    assert.equal(parsed.positionals.length, 1, 'exactly one positional (the prompt): ' + command);
  }
  for (const flag of NEVER_EMITTED) {
    assert.ok(!parsed.args.includes(flag), flag + ' must never be emitted: ' + command);
  }
  if (v['test-watch']) assert.ok(v['allow-shell'], '--test-watch needs --allow-shell: ' + command);
  if (v['no-network']) assert.ok(v['allow-shell'], '--no-network is only meaningful with shell: ' + command);
  if (v['shell-timeout']) assert.ok(v['allow-shell'], '--shell-timeout is only meaningful with shell: ' + command);
  if (v['prompt-arg']) assert.ok(v['prompt-template'], '--prompt-arg needs --prompt-template: ' + command);
  if (v['include-claude-md'] || v['include-repo-map']) {
    assert.ok(v['include-repo-context'], 'CLAUDE.md / repo map need --include-repo-context: ' + command);
  }
  if (v.bare) {
    for (const flag of ['include-instruction-docs', 'include-repo-context', 'include-skills']) {
      assert.ok(!v[flag], '--bare discards --' + flag + ': ' + command);
    }
  }
  // --fork-from mints the child session id itself (bin/local-bridge-runner.js).
  if (v['resume-session']) {
    assert.ok(v['session-id'] || v['session-path'] || v['fork-from'], '--resume-session needs a session: ' + command);
  }
  if (v['session-extract']) {
    assert.ok(v['session-id'] || v['session-path'], '--session-extract needs a saved session: ' + command);
    assert.ok(!v['no-session-persistence'], '--session-extract needs persistence: ' + command);
  }
  const chaos = validateChaosCombo({
    allowShell: !!v['allow-shell'],
    acceptEdits: !!v['accept-edits'],
    dontAsk: !!v['dont-ask'],
    chaosOk: !!v['chaos-ok'],
  });
  assert.ok(chaos.allowed, 'CLI would refuse the chaos combo: ' + command);
  if (v.capabilities) {
    const groups = [...normalizeCapabilityList(v.capabilities)]; // throws on unknown / shell
    for (const group of groups) assert.ok(OPTIONAL_CAPABILITIES.includes(group));
  }
  if (v.tools) {
    for (const name of v.tools.split(',')) assert.ok(TOOLS[name], 'unknown tool in --tools: ' + name);
    assert.ok(!v.capabilities, '--tools and --capabilities must not both be emitted: ' + command);
  }
  if (v['allow-shell'] && v.tools) {
    assert.ok(v.tools.split(',').includes('bash'), 'shell on but bash missing from --tools: ' + command);
  }
  if (!v['allow-shell'] && v.tools) {
    assert.ok(!v.tools.split(',').includes('bash'), 'bash named in --tools without --allow-shell: ' + command);
  }
  if (v['enable-lsp'] && v.tools) {
    assert.ok(v.tools.split(',').includes('lsp_query'), '--enable-lsp without lsp_query in --tools: ' + command);
  }
  const model = v.model || DEFAULT_MODEL;
  // The same validators the CLI runs before any model request.
  resolveModelControls({
    model,
    effort: v.effort,
    thinking: v.thinking,
    temperature: v.temperature ? parseFloat(v.temperature) : undefined,
  });
  deriveContextPolicy({
    model,
    maxTokens: v['max-tokens'] ? parseInt(v['max-tokens'], 10) : 2000,
    compactAtTokens: v['compact-at-tokens'] ? parseInt(v['compact-at-tokens'], 10) : undefined,
  });
}

// ── Real-CLI spawn (dead bridge) ──
// Same tripwire as FG-E7: a dead bridge port means the only acceptable failure
// is a transport error, which proves argument parsing, template resolution,
// the chaos gate, the trust gate, and --worktree entry all passed. HOME is a
// throwaway so Alan's real trust store is never touched.
function childEnv(tmpHome) {
  const env = { ...process.env };
  delete env.BRIDGE_RUNNER_TEST;
  delete env.BRIDGE_RUNNER_ARCHIVE;
  env.HOME = tmpHome;
  env.BRIDGE_RUNNER_BRIDGE_URL = 'http://127.0.0.1:9';
  return env;
}

function makeTargetRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-target-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'sweep@example.invalid']);
  git(['config', 'user.name', 'Sweep']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# sweep target\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'init']);
  return dir;
}

function runGeneratedRunner(command) {
  const tokens = shellSplit(command);
  assert.equal(tokens[1], 'bin/local-bridge-runner.js', 'only runner commands are spawned: ' + command);
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-home-'));
  const result = spawnSync(process.execPath, [RUNNER_BIN, ...tokens.slice(2)], {
    cwd: ROOT,
    env: childEnv(tmpHome),
    encoding: 'utf8',
    timeout: 30000,
  });
  return { ...result, combined: String(result.stdout || '') + String(result.stderr || '') };
}

// Assert a spawned generated command got past every CLI validation and failed
// only because the bridge is unreachable.
function assertReachedTransport(result, label, command) {
  assert.notEqual(result.status, 0, label + ': dead bridge must fail the run');
  assert.doesNotMatch(
    result.combined,
    /Error parsing arguments|Error: --|must be one of|requires --|chaos-ok|not trusted|no prompt provided|could not create an isolated worktree/i,
    label + ' failed CLI validation instead of transport:\n' + command + '\n' + result.combined.slice(0, 600),
  );
  assert.match(
    result.combined,
    /bridge|connect|ECONNREFUSED|network/i,
    label + ' did not reach transport:\n' + command + '\n' + result.combined.slice(0, 600),
  );
  if (command.includes('--worktree')) {
    assert.match(result.combined, /\[runner\] --worktree:/, label + ' did not enter the worktree before transport');
  }
}

function cartesian(dimensions) {
  return dimensions.reduce((acc, dim) => acc.flatMap((prefix) => dim.map((value) => [...prefix, value])), [[]]);
}

module.exports = {
  ROOT,
  RUNNER_BIN,
  RUNNER_CLI_OPTIONS,
  NEVER_EMITTED,
  loadRunnerCliOptions,
  shellSplit,
  parseGenerated,
  assertRunnerInvariants,
  makeTargetRepo,
  runGeneratedRunner,
  assertReachedTransport,
  cartesian,
};
