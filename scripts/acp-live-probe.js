#!/usr/bin/env node
'use strict';

/**
 * scripts/acp-live-probe.js — live health check for the T3 Code launch path.
 *
 * What this proves, in order:
 *   1. bin/t3-cursor-shim.sh answers T3's identity probe ("about") correctly.
 *   2. The local bridge on 127.0.0.1:11437 is up (zero-spend check).
 *   3. The shim launched exactly the way T3 launches it in "auto" mode
 *      (`--auto-review acp`) starts the real ACP agent, and the standard ACP
 *      (Agent Client Protocol) handshake works: initialize -> authenticate ->
 *      session/new -> cursor/list_available_models.
 *   4. A streaming turn can be cancelled mid-way (session/cancel) and the agent
 *      reports stopReason "cancelled" quickly.
 *   5. The bridge is STILL up after that cancel. This is the regression check
 *      for the 2026-08-25 bridge fix (`cbdb59e`): before it, a client that
 *      disconnected mid-stream crashed the bridge process.
 *   6. The same session still answers a second prompt (the cancel did not
 *      poison it), and the agent exits cleanly when we close its stdin.
 *
 * Real model spend: two tiny prompts, the first cancelled early. Side effect:
 * one session checkpoint under ~/.bridge-runner/sessions/, like any T3 thread.
 *
 * Where to run it (Terminal), from the playground folder:
 *   node scripts/acp-live-probe.js               # default model, quiet
 *   node scripts/acp-live-probe.js --verbose     # also show the agent's stderr live
 *   node scripts/acp-live-probe.js --model claude-haiku-4-5
 *
 * It is a plain script, deliberately NOT run under test/setup.js (that harness
 * injects a trust bypass; this probe must exercise the real --trust-workspace
 * path the shim uses). It is also outside the lint/prettier globs, so check it
 * by hand:
 *   npx prettier --check scripts/acp-live-probe.js
 *   npx eslint --config eslint.config.cjs scripts/acp-live-probe.js
 */

const { spawn, spawnSync, execFileSync } = require('node:child_process');
const path = require('node:path');
const { parseArgs } = require('node:util');

// The agent's own JSON-RPC endpoint is symmetric (both sides can call each
// other), so it works unchanged as a *client* when fed the child's stdout and
// told to write to the child's stdin. No second protocol implementation.
const { createConnection } = require('../src/runner/acp/connection');

const SHIM = path.resolve(__dirname, '../bin/t3-cursor-shim.sh');
const T3_VERSION_RE = /^(\d{4})\.(\d{2})\.(\d{2})(?:\b|-|$)/;
const T3_MIN_VERSION_DATE = 20260408;
const FIRST_CHUNK_TIMEOUT_MS = 60_000;
const CANCEL_BUDGET_MS = 2_000; // PASS threshold
const CANCEL_WARN_MS = 1_000; // Slice D measured ~200 ms; warn well before the budget
const EXIT_TIMEOUT_MS = 5_000;
const OVERALL_TIMEOUT_MS = 180_000;

const args = parseArgs({
  options: {
    cwd: { type: 'string' },
    model: { type: 'string' },
    verbose: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});

if (args.values.help) {
  console.log('usage: node scripts/acp-live-probe.js [--cwd <dir>] [--model <id>] [--verbose]');
  process.exit(0);
}

const cwd = path.resolve(args.values.cwd || process.cwd());
const bridgeUrl = (process.env.BRIDGE_RUNNER_BRIDGE_URL || 'http://127.0.0.1:11437').replace(/\/+$/, '');
const verbose = Boolean(args.values.verbose);

const t0 = Date.now();
function stamp() {
  return ((Date.now() - t0) / 1000).toFixed(3).padStart(8) + 's';
}
function log(step, message) {
  console.log(`[${stamp()}] ${step.padEnd(9)} ${message}`);
}

class ProbeFailure extends Error {}
function fail(message) {
  throw new ProbeFailure(message);
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ProbeFailure(`timed out after ${ms} ms waiting for ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── 1. The identity probe, exactly as T3 runs it ─────────────────────────────
function checkAbout() {
  const result = spawnSync(SHIM, ['about', '--format', 'json'], { encoding: 'utf8', timeout: 8_000 });
  if (result.status !== 0) fail(`shim "about" exited ${result.status}: ${result.stderr.trim()}`);
  let about;
  try {
    about = JSON.parse(result.stdout);
  } catch {
    fail('shim "about" did not print JSON: ' + result.stdout.trim());
  }
  const match = String(about.cliVersion || '').match(T3_VERSION_RE);
  if (!match) fail(`cliVersion "${about.cliVersion}" does not start with YYYY.MM.DD`);
  if (Number(match[1] + match[2] + match[3]) < T3_MIN_VERSION_DATE) fail('cliVersion is below T3 minimum');
  if (typeof about.userEmail !== 'string' || !about.userEmail.trim()) fail('userEmail must be a non-empty string');
  log('about', `ok — cliVersion ${about.cliVersion}, userEmail ${about.userEmail}`);
}

// ── 2 / 5. Zero-spend bridge liveness ────────────────────────────────────────
// The bridge answers any unknown path with its own JSON "not_found" error. A
// TCP refusal or a non-JSON body means the bridge process is gone.
async function bridgeAlive(label) {
  let response;
  try {
    response = await fetch(bridgeUrl + '/acp-live-probe-ping', { signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    fail(`${label}: bridge not reachable at ${bridgeUrl} (${err.message}) — start the Claude Local Bridge extension`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    fail(`${label}: bridge answered HTTP ${response.status} without JSON — is something else on that port?`);
  }
  const type = body && body.error && body.error.type;
  if (type !== 'not_found')
    fail(`${label}: unexpected bridge reply (HTTP ${response.status}): ${JSON.stringify(body)}`);
  const pid = bridgePid();
  log(label, `bridge alive at ${bridgeUrl}${pid ? ` (pid ${pid})` : ''}`);
  return pid;
}

// Best effort, read-only: the listening PID lets us prove it is the SAME
// process after the cancel, not a restarted one. Skipped if lsof is missing.
function bridgePid() {
  try {
    const port = new URL(bridgeUrl).port || '80';
    const out = execFileSync('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    });
    return out.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

// ── 3–6. The ACP session through the shim ────────────────────────────────────
async function runSession() {
  // Exactly T3's "auto" mode launch shape (CursorAcpSupport.ts, 2026-09-26).
  const child = spawn(SHIM, ['--auto-review', 'acp'], {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderrLines = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (verbose) process.stderr.write(chunk);
    else stderrLines.push(chunk);
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  let exitInfo = null;
  exited.then((info) => {
    exitInfo = info;
  });

  const connection = createConnection({
    input: child.stdout,
    write: (line) => child.stdin.write(line),
  });

  // Everything the agent streams back lands here. `onChunk` is swapped per
  // prompt so each prompt can react to its own first chunk.
  const chunks = [];
  let onChunk = () => {};
  connection.onMethod('session/update', (params) => {
    const update = params && params.update;
    if (update && update.sessionUpdate === 'agent_message_chunk' && update.content && update.content.text) {
      chunks.push(update.content.text);
      onChunk(update.content.text);
    }
  });
  // The probe is read-only; a permission card here would mean the model tried
  // to write. Answer "deny" so nothing changes on disk, and say so.
  connection.onMethod('session/request_permission', (params) => {
    log('permit', `unexpected approval request for "${params && params.toolCall && params.toolCall.title}" — denied`);
    return { outcome: { outcome: 'selected', optionId: 'reject-once' } };
  });
  connection.onMethod('cursor/ask_question', () => ({ answers: {} }));

  const cleanup = async () => {
    if (exitInfo) return exitInfo;
    child.stdin.end();
    try {
      return await withTimeout(exited, EXIT_TIMEOUT_MS, 'the agent to exit after stdin closed');
    } catch (err) {
      // Our own child handle only — never a pattern kill, never another PID.
      child.kill('SIGTERM');
      throw err;
    }
  };

  try {
    const init = await connection.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { _meta: { parameterizedModelPicker: true } },
    });
    const name = init && init.agentInfo && init.agentInfo.name;
    if (name !== 'bridge-runner-acp') fail(`unexpected agentInfo.name: ${name}`);
    await connection.request('authenticate', { methodId: 'cursor_login' });
    const created = await connection.request('session/new', { cwd, mcpServers: [] });
    const sessionId = created && created.sessionId;
    if (!sessionId) fail('session/new returned no sessionId');
    const catalogue = await connection.request('cursor/list_available_models', {});
    if (!catalogue || !Array.isArray(catalogue.models) || catalogue.models.length === 0) fail('empty model list');
    if (args.values.model) await connection.request('session/set_model', { sessionId, modelId: args.values.model });
    log(
      'handshake',
      `ok — session ${sessionId}, ${catalogue.models.length} models${args.values.model ? `, model ${args.values.model}` : ''}`,
    );

    // ── 4. Stream, then cancel on the first chunk ──
    // A long, many-line answer makes the streaming scrubber release text early
    // (it is line-aligned), so the cancel lands while the model is mid-answer.
    let tFirstChunk = null;
    let tCancel = null;
    const firstChunk = new Promise((resolve) => {
      onChunk = () => {
        if (tFirstChunk !== null) return;
        tFirstChunk = Date.now();
        connection.notify('session/cancel', { sessionId });
        tCancel = Date.now();
        onChunk = () => {};
        resolve();
      };
    });
    const tPrompt = Date.now();
    const promptResponse = connection.request('session/prompt', {
      sessionId,
      prompt: [
        {
          type: 'text',
          text: 'Count from 1 to 80, one number per line, each followed by a different English word. Do not use any tools.',
        },
      ],
    });
    // Whichever comes first: a chunk (good) or the whole response (too fast to cancel).
    const raced = await withTimeout(
      Promise.race([firstChunk.then(() => 'chunk'), promptResponse.then(() => 'response')]),
      FIRST_CHUNK_TIMEOUT_MS,
      'the first streamed chunk',
    );
    if (raced === 'response') {
      const r = await promptResponse;
      fail(`turn finished (${r && r.stopReason}) before any chunk streamed, so the cancel could not be tested — rerun`);
    }
    log('stream', `first chunk after ${tFirstChunk - tPrompt} ms; session/cancel sent`);
    const response = await withTimeout(promptResponse, 30_000, 'the cancelled prompt to return');
    const cancelLatency = Date.now() - tCancel;
    if (!response || response.stopReason !== 'cancelled') {
      fail(
        `expected stopReason "cancelled", got "${response && response.stopReason}" — the turn ended before the cancel landed; rerun`,
      );
    }
    if (cancelLatency > CANCEL_BUDGET_MS) fail(`cancel took ${cancelLatency} ms (budget ${CANCEL_BUDGET_MS} ms)`);
    log(
      'cancel',
      `stopReason cancelled ${cancelLatency} ms after session/cancel${cancelLatency > CANCEL_WARN_MS ? ' (WARN: slower than expected)' : ''}`,
    );

    // ── 5. The bridge must have survived the client-side abort ──
    const pidAfter = await bridgeAlive('survive');

    // ── 6. Same session, second prompt ──
    chunks.length = 0;
    const second = await withTimeout(
      connection.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'Reply with exactly the word: alive' }],
      }),
      60_000,
      'the second prompt',
    );
    if (!second || second.stopReason !== 'end_turn') fail(`second prompt stopReason: ${second && second.stopReason}`);
    if (!/alive/i.test(chunks.join('')))
      fail('second prompt did not contain "alive": ' + JSON.stringify(chunks.join('')));
    log('session', 'second prompt answered on the same session (end_turn, "alive")');

    const info = await cleanup();
    if (info.code !== 0) fail(`agent exited with code ${info.code}${info.signal ? ` (signal ${info.signal})` : ''}`);
    log('exit', 'agent exited 0 after stdin closed');
    return pidAfter;
  } catch (err) {
    if (!verbose && stderrLines.length) {
      console.error('--- agent stderr ---');
      console.error(stderrLines.join('').trimEnd());
      console.error('--------------------');
    }
    try {
      await cleanup();
    } catch {
      // the primary error is what matters
    }
    throw err;
  }
}

async function main() {
  log('probe', `shim ${SHIM}`);
  log('probe', `cwd ${cwd}`);
  checkAbout();
  const pidBefore = await bridgeAlive('baseline');
  const pidAfter = await withTimeout(runSession(), OVERALL_TIMEOUT_MS, 'the whole probe');
  if (pidBefore && pidAfter && pidBefore !== pidAfter) {
    fail(`bridge pid changed ${pidBefore} -> ${pidAfter}: the bridge restarted during the probe`);
  }
  console.log('RESULT: PASS');
}

main().catch((err) => {
  if (err instanceof ProbeFailure) {
    console.error(`[${stamp()}] FAIL      ${err.message}`);
  } else if (err && err.name === 'RpcError') {
    // The agent answered our request with a JSON-RPC error. Its message is
    // already human-readable (e.g. "Bridge returned HTTP 500: ..."), so print
    // that rather than a stack trace.
    console.error(`[${stamp()}] FAIL      the agent reported: ${err.message}`);
  } else {
    console.error(`[${stamp()}] FAIL      unexpected error:`, err);
  }
  if (/proxies|proxy/i.test(String(err && err.message))) {
    // The bridge runs inside an editor extension host and uses that process's
    // proxy settings. A proxy address nothing is listening on means the host
    // window inherited a stale environment (e.g. it was launched from inside
    // a sandboxed agent session). Only a relaunch changes a running process's
    // environment.
    console.error('          hint: the BRIDGE cannot reach Anthropic through the proxy its editor window inherited.');
    console.error(
      '          Close the "[Extension Development Host]" window and press F5 again from a normal Cursor/VS Code window.',
    );
  }
  if (/EPERM/.test(String(err && err.message))) {
    // Seen when this probe is started from inside a sandboxed agent session
    // (Claude Code, Cursor): the child inherits the sandbox and cannot write
    // under ~/.bridge-runner. T3 itself is not sandboxed, so this is a probe
    // environment problem, not a launch-path problem.
    console.error(
      '          hint: EPERM under ~/.bridge-runner usually means a sandboxed agent session started this probe.',
    );
    console.error('          Run it from your own Terminal instead, or point HOME at a scratch folder for a dry run.');
  }
  console.log('RESULT: FAIL');
  process.exitCode = 1;
});
