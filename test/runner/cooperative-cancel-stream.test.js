'use strict';

/**
 * cooperative-cancel-stream.test.js — Slice D at the run() level: the
 * shouldCancel token and the onStreamText live-text port.
 *
 * Why these matter: before Slice D the only cancel path was a signal handler
 * that killed the whole process, and streaming text was mutually exclusive
 * with structured events. A hosted caller (the ACP front end) needs both a
 * cancel that leaves the session resumable and live text alongside events.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const modelClient = require('../../src/runner/model-client');
const { run } = require('../../src/runner/run');
const { STOP_REASONS } = require('../../src/runner/kernel/contract');

let tmpDir;
let originalPost;
let originalPostStream;

function baseOptions(extra) {
  return {
    prompt: 'do the thing',
    cwd: tmpDir,
    model: 'test',
    maxTokens: 10,
    maxSteps: 4,
    skipTrustGate: true,
    quiet: true,
    noArchive: true,
    noSessionPersistence: true,
    ...extra,
  };
}

/** postStream stub that emits the given text as deltas split at `splitAt`. */
function stubStreamedText(text, splitAt) {
  modelClient.postStream = async (body, cb) => {
    if (typeof cb === 'function') {
      cb({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, splitAt) } });
      cb({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(splitAt) } });
    }
    return { content: [{ type: 'text', text }] };
  };
}

describe('run() cooperative cancel and caller streaming', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cancel-stream-'));
    originalPost = modelClient.post;
    originalPostStream = modelClient.postStream;
  });

  afterEach(() => {
    modelClient.post = originalPost;
    modelClient.postStream = originalPostStream;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // run() sets process.exitCode = 1 for any non-success stop (including a
    // deliberate cancel), which would make this whole test FILE exit non-zero
    // even with every assertion green. Same save/restore precedent as
    // agent-loop.test.js.
    process.exitCode = 0;
  });

  it('onStreamText receives the text as live scrubbed deltas', async () => {
    stubStreamedText('streamed hello there', 8);

    const received = [];
    const result = await run(baseOptions({ stream: true, onStreamText: (t) => received.push(t) }));

    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
    assert.equal(received.join(''), 'streamed hello there');
    assert.ok(received.length >= 1, 'deltas were delivered live');
  });

  it('a secret split across two stream chunks never reaches the caller raw', async () => {
    const secret = 'sk-ant-oat01-' + 'a'.repeat(40);
    const text = 'token is ' + secret + '\nplus a safe line';
    // Split INSIDE the secret — the exact case a naive per-chunk scrubber misses.
    stubStreamedText(text, text.indexOf(secret) + 10);

    const received = [];
    await run(baseOptions({ stream: true, onStreamText: (t) => received.push(t) }));

    const joined = received.join('');
    assert.ok(!joined.includes(secret), 'no raw secret in the streamed output');
    assert.ok(joined.includes('plus a safe line'), 'non-secret text still flows');
  });

  it('a throwing onStreamText subscriber cannot take the run down', async () => {
    stubStreamedText('still fine', 4);

    const result = await run(
      baseOptions({
        stream: true,
        onStreamText: () => {
          throw new Error('subscriber exploded');
        },
      }),
    );
    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
  });

  it('without onStreamText the buffered path is untouched', async () => {
    let postCalls = 0;
    modelClient.post = async () => {
      postCalls += 1;
      return { content: [{ type: 'text', text: 'buffered' }] };
    };
    const result = await run(baseOptions());
    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
    assert.equal(postCalls, 1, 'non-streaming callers still use post()');
  });

  it('shouldCancel true before the first step spends nothing', async () => {
    let modelCalls = 0;
    modelClient.post = async () => {
      modelCalls += 1;
      return { content: [{ type: 'text', text: 'should never happen' }] };
    };

    const result = await run(baseOptions({ shouldCancel: () => true }));

    assert.equal(result.stopReason, STOP_REASONS.CANCELLED);
    assert.equal(modelCalls, 0, 'no model call after a pre-run cancel');
  });

  it('a cancel that lands during the model call discards the response before any tool runs', async () => {
    let cancelled = false;
    let asked = 0;
    modelClient.post = async () => {
      // The user hits Stop while this response is in flight.
      cancelled = true;
      return {
        content: [{ type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: 'never.txt', content: 'no' } }],
        stop_reason: 'tool_use',
      };
    };

    const result = await run(
      baseOptions({
        capabilities: ['edits'],
        shouldCancel: () => cancelled,
        confirm: {
          ask: async () => {
            asked += 1;
            return 'allow';
          },
        },
      }),
    );

    assert.equal(result.stopReason, STOP_REASONS.CANCELLED);
    assert.equal(asked, 0, 'no approval was ever requested');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'never.txt')), 'the write never happened');
  });

  it('a cancel during the read batch stops before any write (midTurnCheck seam)', async () => {
    let cancelled = false;
    let asked = 0;
    // One batch: a read-phase tool (ask_user_question, answered by our injected
    // asker, which flips the cancel flag) plus a write. The pipeline runs reads
    // first, then midTurnCheck, then writes — so the write must never start.
    modelClient.post = async () => ({
      content: [
        {
          type: 'tool_use',
          id: 'tu-q',
          name: 'ask_user_question',
          input: { question: 'proceed?', options: [{ label: 'yes' }, { label: 'no' }] },
        },
        { type: 'tool_use', id: 'tu-w', name: 'write_file', input: { path: 'late.txt', content: 'no' } },
      ],
      stop_reason: 'tool_use',
    });

    const result = await run(
      baseOptions({
        capabilities: ['edits'],
        shouldCancel: () => cancelled,
        askUserQuestion: async () => {
          cancelled = true; // Stop clicked while the question was up
          return { ok: true, text: 'yes' };
        },
        confirm: {
          ask: async () => {
            asked += 1;
            return 'allow';
          },
        },
      }),
    );

    assert.equal(result.stopReason, STOP_REASONS.CANCELLED);
    assert.equal(asked, 0, 'the write approval was never requested');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'late.txt')), 'the write never happened');
  });

  it('a cancelled turn leaves the session checkpoint resumable', async () => {
    const sessionPath = path.join(tmpDir, 'cancel-resume.state.json');
    let call = 0;
    let cancelled = false;
    const bodies = [];
    modelClient.post = async (body) => {
      bodies.push(body);
      call += 1;
      if (call === 1) return { content: [{ type: 'text', text: 'remember the word pineapple' }] };
      if (call === 2) {
        // Turn 2 is cancelled while in flight; its tool_use must NOT be
        // checkpointed, or resume would replay a dangling batch.
        cancelled = true;
        return {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: 'x.txt', content: 'x' } }],
          stop_reason: 'tool_use',
        };
      }
      return { content: [{ type: 'text', text: 'resumed fine' }] };
    };

    const shared = { sessionPath, noSessionPersistence: false, capabilities: ['edits'] };
    const turn1 = await run(baseOptions({ ...shared, prompt: 'first' }));
    assert.equal(turn1.stopReason, STOP_REASONS.SUCCESS);

    const turn2 = await run(baseOptions({ ...shared, prompt: 'second', resume: true, shouldCancel: () => cancelled }));
    assert.equal(turn2.stopReason, STOP_REASONS.CANCELLED);

    cancelled = false;
    const turn3 = await run(baseOptions({ ...shared, prompt: 'third', resume: true }));
    assert.equal(turn3.stopReason, STOP_REASONS.SUCCESS, 'resume after cancel works');
    const lastBody = bodies[bodies.length - 1];
    const serialized = JSON.stringify(lastBody.messages);
    assert.ok(serialized.includes('pineapple'), 'turn 1 history survived');
    assert.ok(!serialized.includes('"tu-1"'), 'the cancelled tool_use batch was never checkpointed');
  });
});
