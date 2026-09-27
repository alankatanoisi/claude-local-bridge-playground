#!/usr/bin/env node
'use strict';

// Explicit, bounded live acceptance check. It sends synthetic prompts only.
// Saved evidence contains counts/status, never credentials or private prompts.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { MODES, job, ownsListener } = require('../../src/hosting/control');
const { DEFAULT_MODEL } = require('../../src/models');
async function main() {
  const mode = process.argv[2];
  if (!Object.hasOwn(MODES, mode) || !job(mode).pid) throw new Error('Start a managed mode first');
  const port = MODES[mode];
  if (!ownsListener(mode)) throw new Error('Listener is not owned by the selected managed job');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(os.homedir(), '.bridge-runner', 'hosting-verification');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const results = {
    mode,
    port,
    listenerOwned: true,
    model: DEFAULT_MODEL,
    testedAt: new Date().toISOString(),
    checks: {},
  };
  for (const stream of [false, true]) {
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 48,
        stream,
        messages: [{ role: 'user', content: 'Reply with exactly BRIDGE_OK' }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    const text = await response.text();
    // Streamed text can split a word across events; validate reconstructed text.
    const events = stream
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .flatMap((line) => {
            try {
              return [JSON.parse(line.slice(6))];
            } catch {
              return [];
            }
          })
      : [];
    const answer = stream
      ? events.map((event) => event.delta?.text || '').join('')
      : JSON.parse(text)
          .content?.map((block) => block.text || '')
          .join('');
    const ok =
      response.status === 200 &&
      answer?.includes('BRIDGE_OK') &&
      (!stream || (text.includes('event: message_start') && text.includes('event: message_stop')));
    results.checks[stream ? 'streaming' : 'buffered'] = {
      passed: ok,
      httpStatus: response.status,
      bytes: Buffer.byteLength(text),
    };
    if (!ok) throw new Error(`${mode} ${stream ? 'streaming' : 'buffered'} failed: HTTP ${response.status}`);
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-bridge-host-acceptance-'));
  fs.writeFileSync(path.join(workspace, 'bridge-check.txt'), 'Synthetic bridge tool check.\n');
  const transcript = path.join(root, mode + '-' + runId + '-runner.jsonl');
  const session = path.join(root, mode + '-' + runId + '-runner.state.json');
  const runner = spawn(
    process.execPath,
    [
      path.resolve('bin/local-bridge-runner.js'),
      '--cwd',
      workspace,
      '--bridge-url',
      `http://127.0.0.1:${port}/v1/messages`,
      '--trust-workspace',
      '--bare',
      '--tools',
      'list_files',
      '--max-steps',
      '4',
      '--max-tokens',
      '300',
      '--thinking',
      'off',
      '--max-wall-clock-ms',
      '90000',
      '--transcript',
      transcript,
      '--session-path',
      session,
      '--new-session',
      'Use list_files to list this directory. Then tell me whether bridge-check.txt exists. Do not use any other tool.',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BRIDGE_RUNNER_ARCHIVE: '0' } },
  );
  // Do not emit the runner transcript or ledger contents into the agent chat.
  runner.stdout.resume();
  runner.stderr.resume();
  const timer = setTimeout(() => runner.kill('SIGTERM'), 100000);
  const code = await new Promise((resolve) => runner.once('exit', resolve));
  clearTimeout(timer);
  const lines = fs.existsSync(transcript)
    ? fs
        .readFileSync(transcript, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  let toolUses = 0,
    toolResults = 0;
  function count(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'tool_use' && value.name === 'list_files') toolUses++;
    if (value.type === 'tool_result' && !value.is_error) toolResults++;
    for (const child of Object.values(value)) if (typeof child === 'object') count(child);
  }
  lines.forEach(count);
  results.checks.runner = {
    passed: code === 0 && toolUses > 0 && toolResults > 0,
    exitCode: code,
    listFilesCalls: toolUses,
    successfulToolResults: toolResults,
  };
  fs.rmSync(workspace, { recursive: true, force: true });
  const evidence = path.join(root, mode + '-result.json');
  fs.writeFileSync(evidence, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(results, null, 2));
  if (!results.checks.runner.passed)
    throw new Error('Runner acceptance failed; inspect aggregate transcript structure');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
