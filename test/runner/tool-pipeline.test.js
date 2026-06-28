'use strict';

// Interface tests for the tool pipeline (src/runner/tool-pipeline.js).
// The pipeline is driven exactly the way its two real callers drive it:
// in-memory sinks, a scripted confirm port, and a temp-dir cwd — no TTY,
// no model. These tests replace the old tool-registry dispatch tests:
// the interface is the test surface.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createToolPipeline } = require('../../src/runner/tool-pipeline');

function memorySinks() {
  const calls = [];
  return {
    calls,
    sinks: {
      ledger: {
        append(type, payload) {
          calls.push({ sink: 'ledger', type, payload });
          return { seq: calls.length, ts: 'ts' };
        },
      },
      hooks: {
        dispatch(name, payload) {
          calls.push({ sink: 'hook', type: name, payload });
        },
        noteLedgerEvent() {},
      },
      output: {
        emit(type, fields) {
          calls.push({ sink: 'output', type, payload: fields });
        },
      },
      transcript: {
        append(ev) {
          calls.push({ sink: 'transcript', type: ev.type, payload: ev });
        },
      },
      humanLog: {
        writeToolResult(step, tool, id, result) {
          calls.push({ sink: 'humanLog', type: 'tool_result', payload: { tool, ok: result.ok } });
        },
      },
      trace: {
        append(type, payload) {
          calls.push({ sink: 'trace', type, payload });
        },
        capture(v) {
          return v;
        },
      },
      archive: {
        recordTool(step, tool, id, args, result) {
          calls.push({ sink: 'archive', type: 'tool', payload: { tool, ok: result.ok } });
        },
      },
    },
  };
}

function scriptedConfirm(answers = []) {
  const asked = [];
  return {
    asked,
    async ask(proposedAction) {
      asked.push(proposedAction);
      return answers.length ? answers.shift() : 'deny';
    },
  };
}

function makePipeline(ctx, overrides = {}) {
  const mem = memorySinks();
  const confirm = overrides.confirm || scriptedConfirm(overrides.answers || []);
  const pipeline = createToolPipeline({
    ctx,
    runId: 'run-test',
    confirm,
    sinks: { ...mem.sinks, ...(overrides.sinks || {}) },
    verbosity: { quiet: true },
    failureLimit: overrides.failureLimit === undefined ? 2 : overrides.failureLimit,
    initialFailureStreak: overrides.initialFailureStreak || 0,
  });
  return { pipeline, calls: mem.calls, confirm };
}

function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.js'), 'console.log("hello");\n');
  return dir;
}

function silencedStderr(fn) {
  const original = console.error;
  console.error = () => {};
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = original;
    });
}

describe('tool pipeline — toolDefinitions', () => {
  const tmpDir = freshDir('pipeline-defs-');

  it('exposes exactly the default tool set — bash and apply_patch hidden', () => {
    const { pipeline } = makePipeline({ cwd: tmpDir });
    const names = pipeline.toolDefinitions().map((d) => d.name);
    // The default-exposed set is a contract: the model sees these and only
    // these unless --allow-shell or --allowed-tools changes the surface.
    assert.deepEqual([...names].sort(), [
      'edit_file',
      'enter_worktree',
      'exit_worktree',
      'git_status',
      'glob',
      'list_files',
      'manage_tasks',
      'read_file',
      'search_text',
      'spawn_agent',
      'undo',
      'undo_edit',
      'write_file',
    ]);
    assert.ok(!names.includes('bash'), 'bash hidden without allowShell');
    assert.ok(!names.includes('apply_patch'), 'apply_patch hidden by default');
  });

  it('includes bash with allowShell, honors allowedTools filter', () => {
    const shell = makePipeline({ cwd: tmpDir, allowShell: true });
    assert.ok(
      shell.pipeline
        .toolDefinitions()
        .map((d) => d.name)
        .includes('bash'),
    );
    const filtered = makePipeline({ cwd: tmpDir, allowedTools: new Set(['read_file']) });
    assert.deepEqual(
      filtered.pipeline.toolDefinitions().map((d) => d.name),
      ['read_file'],
    );
  });
});

describe('tool pipeline — read phase', () => {
  it('executes a read and pairs ledger intent/result by effectId', async () => {
    const tmpDir = freshDir('pipeline-read-');
    const { pipeline, calls } = makePipeline({ cwd: tmpDir });

    const turn = await pipeline.executeTurn(1, [{ id: 'r1', name: 'read_file', input: { path: 'src/app.js' } }]);

    assert.equal(turn.aborted, null);
    assert.equal(turn.toolResults.length, 1);
    assert.equal(turn.toolResults[0].is_error, false);
    assert.ok(turn.toolResults[0].content.includes('hello'));
    assert.equal(turn.outcomes[0].phase, 'read');

    const intent = calls.find((c) => c.sink === 'ledger' && c.type === 'tool_effect_intent');
    const result = calls.find((c) => c.sink === 'ledger' && c.type === 'tool_effect_result');
    assert.ok(intent && result, 'both ledger events appended');
    assert.ok(intent.payload.effectId, 'intent carries an effectId');
    assert.equal(result.payload.effectId, intent.payload.effectId, 'effect pairing holds for reads');
    assert.equal(result.payload.ok, true);
  });

  it('fires sinks in the fixed per-tool order', async () => {
    const tmpDir = freshDir('pipeline-order-');
    const { pipeline, calls } = makePipeline({ cwd: tmpDir });

    await pipeline.executeTurn(1, [{ id: 'r1', name: 'read_file', input: { path: 'src/app.js' } }]);

    const order = [
      calls.findIndex((c) => c.sink === 'ledger' && c.type === 'tool_effect_intent'),
      calls.findIndex((c) => c.sink === 'hook' && c.type === 'pre_tool'),
      calls.findIndex((c) => c.sink === 'output' && c.type === 'tool_use'),
      calls.findIndex((c) => c.sink === 'trace' && c.type === 'tool_requested'),
      calls.findIndex((c) => c.sink === 'transcript' && c.type === 'tool_call'),
      calls.findIndex((c) => c.sink === 'transcript' && c.type === 'tool_result'),
      calls.findIndex((c) => c.sink === 'humanLog'),
      calls.findIndex((c) => c.sink === 'trace' && c.type === 'tool_finished'),
      calls.findIndex((c) => c.sink === 'archive'),
      calls.findIndex((c) => c.sink === 'ledger' && c.type === 'tool_effect_result'),
      calls.findIndex((c) => c.sink === 'hook' && c.type === 'post_tool'),
      calls.findIndex((c) => c.sink === 'output' && c.type === 'tool_result'),
    ];
    assert.ok(
      order.every((idx) => idx !== -1),
      'every sink observed the tool use',
    );
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i] > order[i - 1], 'sink #' + i + ' fired in order');
    }
  });

  it('annotates surviving batch siblings when a read fails', async () => {
    const tmpDir = freshDir('pipeline-batch-');
    const { pipeline } = makePipeline({ cwd: tmpDir });

    const turn = await pipeline.executeTurn(1, [
      { id: 'r1', name: 'read_file', input: { path: 'src/app.js' } },
      { id: 'r2', name: 'read_file', input: {} },
    ]);

    const ok = turn.toolResults.find((r) => r.tool_use_id === 'r1');
    const failed = turn.toolResults.find((r) => r.tool_use_id === 'r2');
    assert.equal(failed.is_error, true);
    assert.ok(ok.content.includes('some reads in this batch failed'));
  });

  it('keeps hard denies and unknown tools as is_error results', async () => {
    const tmpDir = freshDir('pipeline-deny-');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=1\n');
    const { pipeline } = makePipeline({ cwd: tmpDir });

    const turn = await silencedStderr(() =>
      pipeline.executeTurn(1, [
        { id: 'r1', name: 'read_file', input: { path: '.env' } },
        { id: 'x1', name: 'some_fake_tool', input: {} },
      ]),
    );

    const envResult = turn.toolResults.find((r) => r.tool_use_id === 'r1');
    assert.equal(envResult.is_error, true);
    assert.ok(envResult.content.includes('Permission denied'));
    const unknown = turn.toolResults.find((r) => r.tool_use_id === 'x1');
    assert.equal(unknown.is_error, true);
    assert.ok(unknown.content.includes('not in the allow-list'));
  });
});

describe('tool pipeline — mid-turn check', () => {
  it('aborts after reads, before any write effect or write intent', async () => {
    const tmpDir = freshDir('pipeline-mid-');
    const { pipeline, calls } = makePipeline({ cwd: tmpDir });
    let observedReads = null;

    const turn = await pipeline.executeTurn(
      1,
      [
        { id: 'r1', name: 'read_file', input: { path: 'src/app.js' } },
        { id: 'w1', name: 'write_file', input: { path: 'new.txt', content: 'x' } },
      ],
      {
        midTurnCheck: (readOutcomes) => {
          observedReads = readOutcomes;
          return { stop: 'test_stop', message: 'stopping for test' };
        },
      },
    );

    assert.deepEqual(turn.aborted, { afterPhase: 'read', reason: 'test_stop', message: 'stopping for test' });
    assert.equal(observedReads.length, 1);
    assert.equal(observedReads[0].phase, 'read');
    assert.equal(fs.existsSync(path.join(tmpDir, 'new.txt')), false, 'write never executed');
    const writeIntents = calls.filter(
      (c) => c.sink === 'ledger' && c.type === 'tool_effect_intent' && c.payload.toolUseId === 'w1',
    );
    assert.equal(writeIntents.length, 0, 'no intent appended for the aborted write');
  });

  it('proceeds to writes when the check returns null', async () => {
    const tmpDir = freshDir('pipeline-mid-ok-');
    const { pipeline } = makePipeline({ cwd: tmpDir, acceptEdits: true });

    const turn = await pipeline.executeTurn(
      1,
      [{ id: 'w1', name: 'write_file', input: { path: 'a.txt', content: 'A' } }],
      {
        midTurnCheck: () => null,
      },
    );

    assert.equal(turn.aborted, null);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8'), 'A');
  });
});

describe('tool pipeline — confirmation flow', () => {
  it('ask → allow executes and records the approval', async () => {
    const tmpDir = freshDir('pipeline-allow-');
    const { pipeline, calls, confirm } = makePipeline({ cwd: tmpDir }, { answers: ['allow'] });

    const turn = await pipeline.executeTurn(1, [
      { id: 'w1', name: 'write_file', input: { path: 'new.txt', content: 'hi' } },
    ]);

    assert.equal(confirm.asked.length, 1);
    assert.equal(turn.toolResults[0].is_error, false);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf8'), 'hi');
    assert.ok(calls.some((c) => c.sink === 'output' && c.type === 'approval_required'));
    assert.ok(calls.some((c) => c.sink === 'transcript' && c.type === 'tool_confirm'));
    assert.ok(
      calls.some((c) => c.sink === 'trace' && c.type === 'approval_resolved' && c.payload.decision === 'allow'),
    );
  });

  it('ask → deny returns a denial result and counts toward the failure streak', async () => {
    const tmpDir = freshDir('pipeline-denyflow-');
    const { pipeline, calls } = makePipeline({ cwd: tmpDir }, { answers: ['deny'] });

    const turn = await pipeline.executeTurn(1, [
      { id: 'w1', name: 'write_file', input: { path: 'new.txt', content: 'hi' } },
    ]);

    assert.equal(fs.existsSync(path.join(tmpDir, 'new.txt')), false);
    assert.equal(turn.toolResults[0].is_error, true);
    assert.ok(turn.toolResults[0].content.includes('User denied this action.'));
    assert.equal(turn.failureStreak, 1);
    assert.ok(calls.some((c) => c.sink === 'transcript' && c.type === 'tool_denied'));
  });

  it('acceptEdits skips confirmation entirely', async () => {
    const tmpDir = freshDir('pipeline-acceptedits-');
    const { pipeline, confirm } = makePipeline({ cwd: tmpDir, acceptEdits: true });

    await pipeline.executeTurn(1, [{ id: 'w1', name: 'write_file', input: { path: 'new.txt', content: 'hi' } }]);

    assert.equal(confirm.asked.length, 0);
    assert.equal(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf8'), 'hi');
  });

  it('hard denies survive even when the user would allow', async () => {
    const tmpDir = freshDir('pipeline-hard-');
    const { pipeline, confirm } = makePipeline({ cwd: tmpDir }, { answers: ['allow'] });

    const turn = await silencedStderr(() =>
      pipeline.executeTurn(1, [{ id: 'w1', name: 'write_file', input: { path: '.env', content: 'SECRET=1' } }]),
    );

    assert.equal(confirm.asked.length, 0, 'hard deny never reaches confirmation');
    assert.equal(turn.toolResults[0].is_error, true);
    assert.ok(turn.toolResults[0].content.includes('Permission denied'));
    assert.equal(fs.existsSync(path.join(tmpDir, '.env')), false);
  });
});

describe('tool pipeline — plan mode', () => {
  it('fabricates results without executing writes', async () => {
    const tmpDir = freshDir('pipeline-plan-');
    const { pipeline, confirm } = makePipeline({ cwd: tmpDir, plan: true });

    const turn = await pipeline.executeTurn(1, [
      { id: 'w1', name: 'write_file', input: { path: 'planned.txt', content: 'nope' } },
    ]);

    assert.equal(confirm.asked.length, 0, 'plan mode never prompts');
    assert.equal(turn.toolResults[0].is_error, false);
    assert.ok(turn.toolResults[0].content.includes('Plan mode: would'));
    assert.equal(fs.existsSync(path.join(tmpDir, 'planned.txt')), false);
  });

  it('plan + acceptEdits with multiple disjoint writes never executes (pre-pass stays off)', async () => {
    const tmpDir = freshDir('pipeline-planpre-');
    const { pipeline, calls } = makePipeline({ cwd: tmpDir, plan: true, acceptEdits: true });

    const turn = await pipeline.executeTurn(1, [
      { id: 'w1', name: 'write_file', input: { path: 'a.txt', content: 'A' } },
      { id: 'w2', name: 'write_file', input: { path: 'b.txt', content: 'B' } },
    ]);

    assert.equal(fs.existsSync(path.join(tmpDir, 'a.txt')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'b.txt')), false);
    assert.ok(turn.toolResults.every((r) => r.content.includes('Plan mode: would')));
    assert.ok(
      !calls.some((c) => c.sink === 'ledger' && c.type === 'tool_use_group'),
      'no parallel pre-pass group in plan mode',
    );
  });
});

describe('tool pipeline — accept-edits parallel pre-pass', () => {
  it('pre-executes disjoint writes and still records in model-emitted order', async () => {
    const tmpDir = freshDir('pipeline-prepass-');
    const { pipeline, calls } = makePipeline({ cwd: tmpDir, acceptEdits: true });

    const turn = await pipeline.executeTurn(1, [
      { id: 'w1', name: 'write_file', input: { path: 'a.txt', content: 'A' } },
      { id: 'w2', name: 'write_file', input: { path: 'b.txt', content: 'B' } },
    ]);

    assert.equal(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8'), 'A');
    assert.equal(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8'), 'B');
    assert.ok(calls.some((c) => c.sink === 'ledger' && c.type === 'tool_use_group'));
    assert.equal(turn.toolResults[0].tool_use_id, 'w1');
    assert.equal(turn.toolResults[1].tool_use_id, 'w2');
    const firstResult = calls.findIndex(
      (c) => c.sink === 'output' && c.type === 'tool_result' && c.payload.tool_use_id === 'w1',
    );
    const secondResult = calls.findIndex(
      (c) => c.sink === 'output' && c.type === 'tool_result' && c.payload.tool_use_id === 'w2',
    );
    assert.ok(firstResult < secondResult, 'sinks observe model-emitted order');
  });
});

describe('tool pipeline — failure streak', () => {
  it('escalates after failureLimit consecutive failures and resets on success', async () => {
    const tmpDir = freshDir('pipeline-streak-');
    const { pipeline } = makePipeline({ cwd: tmpDir, acceptEdits: true }, { failureLimit: 2 });

    const turn = await silencedStderr(() =>
      pipeline.executeTurn(1, [
        { id: 'w1', name: 'write_file', input: {} },
        { id: 'w2', name: 'write_file', input: {} },
      ]),
    );

    assert.equal(turn.escalated, true);
    assert.equal(turn.failureStreak, 2);
    assert.ok(turn.toolResults[1].content.includes('consecutive tool failures'));

    const recovery = await pipeline.executeTurn(2, [
      { id: 'w3', name: 'write_file', input: { path: 'ok.txt', content: 'x' } },
    ]);
    assert.equal(recovery.failureStreak, 0);
    assert.equal(pipeline.failureStreak, 0);
  });

  it('seeds from initialFailureStreak and shares the streak with external failures', async () => {
    const tmpDir = freshDir('pipeline-seed-');
    const { pipeline } = makePipeline({ cwd: tmpDir, acceptEdits: true }, { failureLimit: 2, initialFailureStreak: 1 });

    assert.equal(pipeline.failureStreak, 1);
    assert.equal(pipeline.recordExternalFailure(), 2);
    assert.equal(pipeline.failureStreak, 2);

    const turn = await silencedStderr(() => pipeline.executeTurn(1, [{ id: 'w1', name: 'write_file', input: {} }]));
    assert.equal(turn.escalated, true, 'seeded streak escalates on the next failure');
  });
});

describe('tool pipeline — sink criticality', () => {
  it('best-effort sinks may fail without altering results', async () => {
    const tmpDir = freshDir('pipeline-besteffort-');
    const { pipeline } = makePipeline(
      { cwd: tmpDir },
      {
        sinks: {
          humanLog: {
            writeToolResult() {
              throw new Error('disk full');
            },
          },
          transcript: {
            append() {
              throw new Error('disk full');
            },
          },
        },
      },
    );

    const turn = await pipeline.executeTurn(1, [{ id: 'r1', name: 'read_file', input: { path: 'src/app.js' } }]);
    assert.equal(turn.toolResults[0].is_error, false);
    assert.ok(turn.toolResults[0].content.includes('hello'));
  });

  it('the ledger is critical — its failure aborts before execution', async () => {
    const tmpDir = freshDir('pipeline-critical-');
    const { pipeline } = makePipeline(
      { cwd: tmpDir, acceptEdits: true },
      {
        sinks: {
          ledger: {
            append() {
              throw new Error('ledger disk full');
            },
          },
        },
      },
    );

    await assert.rejects(
      () => pipeline.executeTurn(1, [{ id: 'w1', name: 'write_file', input: { path: 'never.txt', content: 'x' } }]),
      /ledger disk full/,
    );
    assert.equal(fs.existsSync(path.join(tmpDir, 'never.txt')), false, 'effect never executed without its intent');
  });

  it('rejects malformed toolUses', async () => {
    const tmpDir = freshDir('pipeline-malformed-');
    const { pipeline } = makePipeline({ cwd: tmpDir });
    await assert.rejects(() => pipeline.executeTurn(1, [{ name: 'read_file' }]), /array of \{ id, name, input \}/);
  });
});
