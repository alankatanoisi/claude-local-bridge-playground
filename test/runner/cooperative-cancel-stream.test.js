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
const http = require('http');

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

  it('an in-flight stream abort (BridgeCancelledError) maps to cancelled, not bridge error', async () => {
    // model-client destroys the request the moment the cancel token flips and
    // rejects with isCancelled — run() must treat that as a clean cancel, not
    // enter the bridge-error retry path.
    let calls = 0;
    modelClient.postStream = async () => {
      calls += 1;
      const err = new Error('Streamed request cancelled by the caller');
      err.isCancelled = true;
      throw err;
    };

    const result = await run(baseOptions({ stream: true, onStreamText: () => {}, shouldCancel: () => true }));

    // shouldCancel true is caught at the top-of-step checkpoint first, so
    // force the postStream path with a token that flips only mid-flight:
    assert.equal(result.stopReason, STOP_REASONS.CANCELLED);
    assert.equal(calls, 0, 'pre-step checkpoint fired before any request');

    let flipped = false;
    modelClient.postStream = async () => {
      flipped = true; // cancel "arrives" while the request is in flight
      const err = new Error('Streamed request cancelled by the caller');
      err.isCancelled = true;
      throw err;
    };
    const midFlight = await run(baseOptions({ stream: true, onStreamText: () => {}, shouldCancel: () => flipped }));
    assert.equal(midFlight.stopReason, STOP_REASONS.CANCELLED, 'in-flight abort is a cancel, not a bridge error');
  });

  it('real postStream fires no callback after a cancel abort (High #2, 2026-08-25)', async () => {
    // A REAL local SSE server that keeps dripping frames until its socket
    // dies — so any callback leak after the abort would be caught red-handed.
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const iv = setInterval(() => {
        res.write('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"drip\\n"}}\n\n');
      }, 20);
      res.on('close', () => clearInterval(iv));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const bridgeUrl = 'http://127.0.0.1:' + server.address().port;

    let cancelled = false;
    let cbCount = 0;
    try {
      const pending = originalPostStream(
        { model: 'test', stream: true, messages: [] },
        () => {
          cbCount += 1;
          if (cbCount >= 2) cancelled = true; // the user hits Stop mid-stream
        },
        bridgeUrl,
        { shouldCancel: () => cancelled },
      );
      await assert.rejects(pending, (err) => err.isCancelled === true);
      const countAtReject = cbCount;
      // The server keeps emitting until the destroyed socket closes; give any
      // leaked events ample time to surface.
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(cbCount, countAtReject, 'no callback fired after the rejection');
    } finally {
      server.close();
    }
  });

  it('a mid-batch cancel persists a complete tool batch — resume needs no crash repair (High #1)', async () => {
    const sessionPath = path.join(tmpDir, 'midturn-cancel.state.json');
    let call = 0;
    let cancelled = false;
    const bodies = [];
    modelClient.post = async (body) => {
      bodies.push(body);
      call += 1;
      if (call === 1) {
        // One batch: a read-phase question plus a write. Cancel lands during
        // the read, so the write never runs — but the READ's real result must
        // survive into the checkpoint instead of an F6 crash placeholder.
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu-q',
              name: 'ask_user_question',
              input: { question: 'go?', options: [{ label: 'yes' }, { label: 'no' }] },
            },
            { type: 'tool_use', id: 'tu-w', name: 'write_file', input: { path: 'skipped.txt', content: 'no' } },
          ],
          stop_reason: 'tool_use',
        };
      }
      return { content: [{ type: 'text', text: 'resumed cleanly' }] };
    };

    const shared = { sessionPath, noSessionPersistence: false, capabilities: ['edits'] };
    const turn1 = await run(
      baseOptions({
        ...shared,
        prompt: 'first',
        shouldCancel: () => cancelled,
        askUserQuestion: async () => {
          cancelled = true; // Stop clicked while the question card was up
          return { ok: true, text: 'PROCEED_CONFIRMED' };
        },
        confirm: { ask: async () => 'allow' },
      }),
    );
    assert.equal(turn1.stopReason, STOP_REASONS.CANCELLED);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'skipped.txt')), 'the write never ran');

    cancelled = false;
    const turn2 = await run(baseOptions({ ...shared, prompt: 'second', resume: true }));
    assert.equal(turn2.stopReason, STOP_REASONS.SUCCESS, 'resume works after a mid-batch cancel');

    const serialized = JSON.stringify(bodies[bodies.length - 1].messages);
    assert.ok(serialized.includes('PROCEED_CONFIRMED'), 'the real read result survived into the resumed history');
    assert.ok(
      serialized.includes('Turn stopped before this tool ran'),
      'the skipped write got an honest synthetic result',
    );
    assert.ok(!serialized.includes('Recovered after crash'), 'no F6 crash-repair language for a deliberate Stop');
  });

  it('caller streaming disables stdout token streaming and marks the result streamed (M4)', async () => {
    let capturedOpts = null;
    modelClient.postStream = async (body, cb, bridgeUrl, opts) => {
      capturedOpts = opts;
      cb({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'line one\n' } });
      return { content: [{ type: 'text', text: 'line one\n' }] };
    };

    const result = await run(baseOptions({ stream: true, onStreamText: () => {} }));

    assert.equal(capturedOpts.streamOutput, false, 'no live tokens go to process.stdout for a hosted caller');
    assert.equal(result.streamed, true, 'finish() must not reprint the answer either');
    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
  });

  it('a transient bridge error after delivered deltas is NOT retried (M5)', async () => {
    let calls = 0;
    const received = [];
    modelClient.postStream = async (body, cb) => {
      calls += 1;
      cb({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial line\n' } });
      const err = new Error('Stream error: ECONNRESET'); // matches the transient classifier
      throw err;
    };

    const result = await run(baseOptions({ stream: true, onStreamText: (t) => received.push(t) }));

    assert.equal(calls, 1, 'no retry once the client has already seen text');
    assert.equal(result.stopReason, STOP_REASONS.BRIDGE_ERROR);
    assert.equal(received.join(''), 'partial line\n', 'the prefix was delivered exactly once');
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
