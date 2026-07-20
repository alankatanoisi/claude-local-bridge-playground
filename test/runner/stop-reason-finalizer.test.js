'use strict';

/**
 * P1-02 + P1-04 — upstream stop_reason preservation and the single terminal
 * finalizer.
 *
 * P1-02: a no-tool-use response is a success only when the upstream
 * stop_reason is an actual end of turn. max_tokens / refusal map to their own
 * terminal stop reasons and exit non-zero.
 *
 * P1-04: every terminal path emits exactly one terminal output event
 * ('result' or 'error' carrying stop_reason) and the run result always carries
 * an autopsy.
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const modelClient = require('../../src/runner/model-client');
const { run } = require('../../src/runner/run');
const { STOP_REASONS, mapUpstreamStopReason } = require('../../src/runner/kernel/contract');

const originalPost = modelClient.post;

function scriptedPost(responses) {
  let i = 0;
  modelClient.post = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      id: 'msg_' + i,
      content: r.content,
      usage: r.usage || { input_tokens: 5, output_tokens: 5 },
      stop_reason: r.stop_reason,
    };
  };
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stopreason-'));
}

async function quietRun(opts) {
  const savedExit = process.exitCode;
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await run({ model: 'test', maxTokens: 50, quiet: true, ...opts });
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = savedExit;
  }
}

describe('mapUpstreamStopReason', () => {
  it('maps truncation and refusal, passes everything else as success', () => {
    assert.equal(mapUpstreamStopReason('max_tokens'), STOP_REASONS.MODEL_MAX_TOKENS);
    assert.equal(mapUpstreamStopReason('refusal'), STOP_REASONS.MODEL_REFUSAL);
    assert.equal(mapUpstreamStopReason('end_turn'), STOP_REASONS.SUCCESS);
    assert.equal(mapUpstreamStopReason('stop_sequence'), STOP_REASONS.SUCCESS);
    assert.equal(mapUpstreamStopReason(null), STOP_REASONS.SUCCESS);
    assert.equal(mapUpstreamStopReason('some_future_reason'), STOP_REASONS.SUCCESS);
  });
});

describe('run loop — upstream stop_reason mapping (P1-02)', () => {
  afterEach(() => {
    modelClient.post = originalPost;
  });

  it('max_tokens no longer masquerades as success', async () => {
    scriptedPost([{ content: [{ type: 'text', text: 'partial answer that got cut' }], stop_reason: 'max_tokens' }]);
    const result = await quietRun({ prompt: 'hi', cwd: freshDir(), maxSteps: 2 });

    assert.equal(result.stopReason, STOP_REASONS.MODEL_MAX_TOKENS);
    assert.equal(result.upstreamStopReason, 'max_tokens');
    assert.ok(result.finalText.includes('truncated'));
    assert.ok(result.finalText.includes('partial answer that got cut'), 'partial output preserved');
    const terminal = result.events.filter((e) => e.type === 'result' || e.type === 'error');
    assert.equal(terminal.length, 1, 'exactly one terminal event');
    assert.equal(terminal[0].type, 'error');
    assert.equal(terminal[0].stop_reason, STOP_REASONS.MODEL_MAX_TOKENS);
  });

  it('refusal maps to model_refusal', async () => {
    scriptedPost([{ content: [{ type: 'text', text: 'I cannot help with that.' }], stop_reason: 'refusal' }]);
    const result = await quietRun({ prompt: 'hi', cwd: freshDir(), maxSteps: 2 });
    assert.equal(result.stopReason, STOP_REASONS.MODEL_REFUSAL);
    assert.equal(result.upstreamStopReason, 'refusal');
  });

  it('end_turn stays a success and records the upstream reason', async () => {
    scriptedPost([{ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }]);
    const result = await quietRun({ prompt: 'hi', cwd: freshDir(), maxSteps: 2 });
    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
    assert.equal(result.upstreamStopReason, 'end_turn');
    const terminal = result.events.filter((e) => e.type === 'result' || e.type === 'error');
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].type, 'result');
    assert.equal(terminal[0].upstream_stop_reason, 'end_turn');
  });
});

describe('run loop — single terminal finalizer (P1-04)', () => {
  afterEach(() => {
    modelClient.post = originalPost;
  });

  it('max_steps path emits one terminal error event and an autopsy', async () => {
    // Model always asks for another tool call, so the loop hits max_steps.
    scriptedPost([
      { content: [{ type: 'tool_use', id: 'tu1', name: 'list_files', input: {} }], stop_reason: 'tool_use' },
    ]);
    const result = await quietRun({ prompt: 'loop forever', cwd: freshDir(), maxSteps: 2 });

    assert.equal(result.stopReason, STOP_REASONS.MAX_STEPS);
    assert.ok(result.autopsy, 'autopsy attached on non-success paths too');
    const terminal = result.events.filter((e) => e.type === 'result' || e.type === 'error');
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].stop_reason, STOP_REASONS.MAX_STEPS);
  });

  it('success path emits one terminal result event and an autopsy', async () => {
    scriptedPost([{ content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' }]);
    const result = await quietRun({ prompt: 'hi', cwd: freshDir(), maxSteps: 2 });
    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
    assert.ok(result.autopsy);
    const terminal = result.events.filter((e) => e.type === 'result' || e.type === 'error');
    assert.equal(terminal.length, 1);
  });

  it('plan-mode runs surface recorded proposals on the result', async () => {
    scriptedPost([
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'write_file', input: { path: 'a.txt', content: 'hi\n' } }],
        stop_reason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Plan complete.' }], stop_reason: 'end_turn' },
    ]);
    const cwd = freshDir();
    const result = await quietRun({ prompt: 'plan it', cwd, maxSteps: 3, plan: true });
    assert.equal(result.stopReason, STOP_REASONS.SUCCESS);
    assert.ok(Array.isArray(result.planProposals));
    assert.equal(result.planProposals.length, 1);
    assert.equal(result.planProposals[0].tool, 'write_file');
    assert.equal(fs.existsSync(path.join(cwd, 'a.txt')), false);
  });
});

describe('model-client streaming — stop_reason preservation (P1-02)', () => {
  it('captures stop_reason and usage from message_delta frames', async () => {
    const http = require('http');
    const frames = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s","role":"assistant","type":"message","usage":{"input_tokens":10}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"output_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const frame of frames) res.write(frame);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/v1/messages';

    try {
      const response = await modelClient.postStream({ model: 'test' }, null, url, { streamOutput: false });
      assert.equal(response.stop_reason, 'max_tokens');
      assert.equal(response.usage.input_tokens, 10);
      assert.equal(response.usage.output_tokens, 7);
      assert.equal(response.content[0].text, 'hi');
    } finally {
      server.close();
    }
  });
});
