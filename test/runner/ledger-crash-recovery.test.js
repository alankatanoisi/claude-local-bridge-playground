'use strict';

/**
 * Ledger crash-recovery tests — the repo's first tests that kill a real runner
 * process mid-run and inspect what the durability layers retained.
 *
 * Born from the A1 crash bakeoff (docs/durability-crash-bakeoff-2026-07-31.md).
 * Layout per test: a throwaway workspace + session dir, an in-test mock
 * Messages server that scripts THREE side-effecting write_file calls, and a
 * runner child spawned through the real CLI entrypoint.
 *
 * Determinism note: SIGTERM is the deterministic half (Node delivers it on the
 * event loop, after the current synchronous tool batch, so the finalizer runs
 * and the outcome is exact). SIGKILL timing is inherently racy, so the SIGKILL
 * test asserts invariants that hold at ANY kill point rather than one exact
 * crash frame.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const { replayFromLedger } = require('../../src/runner/replay-simulator');
const { planRepair, reconcileForResume } = require('../../src/runner/ledger-repair');
const { assertValidAnthropicMessages } = require('../../src/runner/message-contract');
const { SessionStore } = require('../../src/runner/session-store');

const RUNNER_BIN = path.join(__dirname, '..', '..', 'bin', 'local-bridge-runner.js');

// ── in-test mock Messages server: three write_file effects, then end_turn ──
// Turn detection counts tool_result blocks across all messages, so it is
// stateless and deterministic across runner restarts (resume replays work).
function makeMockServer() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        body = {};
      }
      let toolResults = 0;
      for (const m of body.messages || []) {
        if (!Array.isArray(m.content)) continue;
        toolResults += m.content.filter((b) => b && b.type === 'tool_result').length;
      }
      server._requests = (server._requests || 0) + 1;
      const seq = server._requests;
      const response =
        toolResults >= 3
          ? {
              id: 'msg_final_r' + seq,
              type: 'message',
              role: 'assistant',
              model: 'mock-crash',
              content: [{ type: 'text', text: 'All effects written.' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 20 },
            }
          : {
              id: 'msg_e' + (toolResults + 1) + '_r' + seq,
              type: 'message',
              role: 'assistant',
              model: 'mock-crash',
              content: [
                { type: 'text', text: 'Writing effect ' + (toolResults + 1) + '.' },
                {
                  type: 'tool_use',
                  id: 'toolu_e' + (toolResults + 1) + '_r' + seq,
                  name: 'write_file',
                  input: {
                    // The request-seq suffix makes every (re-)execution leave a
                    // distinct file, so double-execution is countable on disk.
                    path: 'effect-' + (toolResults + 1) + '-r' + seq + '.txt',
                    content: 'effect ' + (toolResults + 1) + ' via request ' + seq + '\n',
                  },
                },
              ],
              stop_reason: 'tool_use',
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 40 },
            };
      const payload = JSON.stringify(response);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(payload);
    });
  });
  return server;
}

function makeTrialDirs(prefix) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cwd = path.join(base, 'project');
  const sessions = path.join(base, 'sessions');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'readme.txt'), 'crash-recovery fixture\n');
  return {
    base,
    cwd,
    sessionPath: path.join(sessions, 'crash.state.json'),
    ledgerPath: path.join(sessions, 'crash.ledger.jsonl'),
  };
}

function spawnRunner({ prompt, cwd, port, sessionPath, resume }) {
  const args = [
    RUNNER_BIN,
    prompt,
    '--cwd',
    cwd,
    '--bridge-url',
    'http://127.0.0.1:' + port + '/v1/messages',
    '--session-path',
    sessionPath,
    '--trust-workspace',
    '--capabilities',
    'edits',
    '--accept-edits',
    '--max-steps',
    '10',
    '--output-format',
    'json',
    '--log-level',
    'quiet',
  ];
  if (resume) args.splice(2, 0, '--resume-session');
  const child = spawn(process.execPath, args, {
    // Default debounce (75 ms) on purpose: the crash window under test.
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, exit };
}

function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  return fs
    .readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function effectFiles(cwd) {
  return fs
    .readdirSync(cwd)
    .filter((n) => /^effect-\d+-r\d+\.txt$/.test(n))
    .sort();
}

/** Poll (2 ms) until the ledger contains `n` events of `type`, or time out. */
function waitForLedgerEvent(ledgerPath, type, n, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const iv = setInterval(() => {
      const count = readLedger(ledgerPath).filter((e) => e.type === type).length;
      if (count >= n) {
        clearInterval(iv);
        resolve(count);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        reject(new Error('timed out waiting for ' + n + '× ' + type));
      }
    }, 2);
  });
}

describe('ledger crash recovery (process-kill integration)', () => {
  let server;
  let port;

  before(async () => {
    server = makeMockServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
  });

  it('SIGTERM mid-run finalizes: flushed checkpoint, run_stopped ledger tail, exit 143, clean resume with no double-execution', async () => {
    const t = makeTrialDirs('crash-sigterm-');
    const run1 = spawnRunner({ prompt: 'Write the effect files.', cwd: t.cwd, port, sessionPath: t.sessionPath });

    // Kill the moment the runner commits to the SECOND side effect.
    await waitForLedgerEvent(t.ledgerPath, 'tool_effect_intent', 2);
    run1.child.kill('SIGTERM');
    const exit1 = await run1.exit;

    // F8 fix contract: SIGTERM now funnels through the finalizer.
    assert.equal(exit1.code, 143, 'graceful SIGTERM exit code (128+15)');
    const events = readLedger(t.ledgerPath);
    assert.equal(events[events.length - 1].type, 'run_stopped', 'ledger closes with run_stopped');

    // Every intent got its paired result before the process died (the handler
    // runs after the current synchronous tool batch), so replay is clean.
    const replay = replayFromLedger(t.sessionPath);
    assert.equal(replay.ok, true, 'no pending effects after graceful SIGTERM: ' + JSON.stringify(replay.issues));

    // Checkpoint was flushed synchronously on the way out: it must contain the
    // completed tool exchange, not just the opening user prompt.
    const state = JSON.parse(fs.readFileSync(t.sessionPath, 'utf8'));
    assert.ok(state.messages.length >= 3, 'checkpoint has the completed exchanges, got ' + state.messages.length);
    assert.ok(state.runner.health, 'health record written on SIGTERM');

    // Resume completes the task without re-running finished side effects.
    const filesBefore = effectFiles(t.cwd);
    const run2 = spawnRunner({
      prompt: 'Continue and finish.',
      cwd: t.cwd,
      port,
      sessionPath: t.sessionPath,
      resume: true,
    });
    const exit2 = await run2.exit;
    assert.equal(exit2.code, 0, 'resume completes cleanly');

    const filesAfter = effectFiles(t.cwd);
    const perEffect = {};
    for (const f of filesAfter) {
      const n = f.match(/^effect-(\d+)-/)[1];
      perEffect[n] = (perEffect[n] || 0) + 1;
    }
    for (const [n, count] of Object.entries(perEffect)) {
      assert.equal(count, 1, 'effect ' + n + ' executed exactly once (no double-execution)');
    }
    assert.ok(filesAfter.length >= filesBefore.length, 'resume never loses effects');
  });

  it('SIGKILL mid-run: ledger survives with parseable pairing invariants and planRepair mirrors replay issues', async () => {
    const t = makeTrialDirs('crash-sigkill-');
    const run1 = spawnRunner({ prompt: 'Write the effect files.', cwd: t.cwd, port, sessionPath: t.sessionPath });

    await waitForLedgerEvent(t.ledgerPath, 'tool_effect_intent', 2);
    run1.child.kill('SIGKILL');
    const exit1 = await run1.exit;
    assert.equal(exit1.signal, 'SIGKILL');

    // SIGKILL timing is racy, so assert invariants that hold at ANY kill frame:
    // 1. The append-only ledger survived and parses line-by-line.
    const events = readLedger(t.ledgerPath);
    assert.ok(events.length >= 2, 'ledger retained events written before the kill');

    // 2. Effect pairing is one-directional: results never appear without their
    //    intent (intents without results are the expected crash residue).
    const intentIds = new Set(events.filter((e) => e.type === 'tool_effect_intent').map((e) => e.effectId));
    for (const ev of events.filter((e) => e.type === 'tool_effect_result')) {
      assert.ok(intentIds.has(ev.effectId), 'result ' + ev.effectId + ' has a recorded intent');
    }

    // 3. replayFromLedger classifies the crash without throwing, and planRepair
    //    proposes exactly one action per issue. F6 applyRepair can mutate when
    //    approved (covered in ledger-repair.test.js); here we only assert the
    //    plan still mirrors replay after a real SIGKILL.
    const replay = replayFromLedger(t.sessionPath);
    const plan = planRepair(t.sessionPath);
    // plan.issues is a superset of replay.issues (adds dangling / missing-completed
    // from checkpoint inspection).
    assert.ok(plan.issues.length >= replay.issues.length);
    assert.ok(plan.repairPlan.length >= replay.issues.length, 'at least one repair action per replay issue');
    for (const issue of plan.issues) {
      assert.ok(
        ['pending_effect', 'sequence_gap', 'orphaned_tool_use', 'dangling_tool_use', 'missing_completed_effect'].includes(
          issue.kind,
        ),
        'known issue kind: ' + issue.kind,
      );
    }
  });

  it('F6 stale-checkpoint: reconcile reconstructs completed effects so resume does not double-execute', async () => {
    // Deterministic A1-F2 shape: run cleanly through two effects, then truncate
    // the checkpoint to the opening prompt while leaving the ledger intact.
    const t = makeTrialDirs('crash-f6-stale-');
    const run1 = spawnRunner({ prompt: 'Write the effect files.', cwd: t.cwd, port, sessionPath: t.sessionPath });
    await waitForLedgerEvent(t.ledgerPath, 'tool_effect_result', 2);
    // Let the run finish the remaining effect + end_turn so the ledger has a
    // clean completed pair for effects 1–2 (and possibly 3).
    const exit1 = await run1.exit;
    assert.equal(exit1.code, 0, 'baseline run completes');

    const filesAfterRun = effectFiles(t.cwd);
    assert.ok(filesAfterRun.length >= 2, 'at least two effects on disk');

    // Induce the stale-checkpoint shape A1 measured under default debounce.
    const store = new SessionStore(t.sessionPath);
    store.load();
    const opening = store.messages.find((m) => m.role === 'user');
    assert.ok(opening, 'had an opening user message');
    store.setMessages([opening]);
    store.flushSync();

    const plan = planRepair(t.sessionPath);
    assert.ok(
      plan.repairPlan.some((a) => a.action === 'inject_recovered_exchange'),
      'plan proposes recovered exchanges for ledger-completed effects',
    );

    const reconciled = reconcileForResume(t.sessionPath, [opening]);
    assert.equal(reconciled.mutated, true);
    assertValidAnthropicMessages(reconciled.messages);

    const filesBeforeResume = effectFiles(t.cwd);
    const run2 = spawnRunner({
      prompt: 'Continue only if something remains; otherwise say done.',
      cwd: t.cwd,
      port,
      sessionPath: t.sessionPath,
      resume: true,
    });
    const exit2 = await run2.exit;
    assert.equal(exit2.code, 0, 'ledger-aware resume completes');

    const filesAfterResume = effectFiles(t.cwd);
    // Resume must not create a second file for an effect number that already
    // existed before reconcile (that would be silent double-execution).
    const beforeByEffect = {};
    for (const f of filesBeforeResume) {
      const n = f.match(/^effect-(\d+)-/)[1];
      beforeByEffect[n] = (beforeByEffect[n] || 0) + 1;
    }
    const afterByEffect = {};
    for (const f of filesAfterResume) {
      const n = f.match(/^effect-(\d+)-/)[1];
      afterByEffect[n] = (afterByEffect[n] || 0) + 1;
    }
    for (const [n, beforeCount] of Object.entries(beforeByEffect)) {
      assert.equal(
        afterByEffect[n],
        beforeCount,
        'effect ' + n + ' must not be re-executed after ledger-aware resume',
      );
    }
  });

  it('F6 dangling tool_use: debounce-0 SIGKILL mid-tool becomes resumable after repair', async () => {
    const t = makeTrialDirs('crash-f6-dangle-');
    const args = [
      RUNNER_BIN,
      'Write the effect files.',
      '--cwd',
      t.cwd,
      '--bridge-url',
      'http://127.0.0.1:' + port + '/v1/messages',
      '--session-path',
      t.sessionPath,
      '--trust-workspace',
      '--capabilities',
      'edits',
      '--accept-edits',
      '--max-steps',
      '10',
      '--output-format',
      'json',
      '--log-level',
      'quiet',
    ];
    const child = spawn(process.execPath, args, {
      env: { ...process.env, BRIDGE_RUNNER_SESSION_DEBOUNCE_MS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));

    // Kill after the 2nd intent while debounce-0 has already flushed the
    // assistant tool_use — the classic dangling-batch strand.
    await waitForLedgerEvent(t.ledgerPath, 'tool_effect_intent', 2);
    child.kill('SIGKILL');
    await exit;

    const state = JSON.parse(fs.readFileSync(t.sessionPath, 'utf8'));
    // If the kill landed after a completed tool_result batch, skip — timing
    // is still somewhat racy even with debounce 0. Assert only when dangling.
    const last = state.messages[state.messages.length - 1];
    const dangling =
      last &&
      last.role === 'assistant' &&
      Array.isArray(last.content) &&
      last.content.some((b) => b && b.type === 'tool_use');
    if (!dangling) {
      // Invariant still holds: applyRepair is a no-op on a contract-valid checkpoint.
      const plan = planRepair(t.sessionPath);
      const auto = plan.repairPlan.filter((a) => a.action === 'inject_synthetic_tool_result');
      assert.equal(auto.length, 0);
      return;
    }

    assert.throws(() => assertValidAnthropicMessages(state.messages), /tool_use batch/);

    const reconciled = reconcileForResume(t.sessionPath, state.messages);
    assert.equal(reconciled.mutated, true);
    assertValidAnthropicMessages(reconciled.messages);

    const run2 = spawnRunner({
      prompt: 'Continue and finish.',
      cwd: t.cwd,
      port,
      sessionPath: t.sessionPath,
      resume: true,
    });
    const exit2 = await run2.exit;
    assert.equal(exit2.code, 0, 'resume after dangling repair completes');
  });
});
