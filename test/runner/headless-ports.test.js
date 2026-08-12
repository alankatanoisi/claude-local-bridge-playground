'use strict';

/**
 * headless-ports.test.js — the runner must be drivable by a caller that has no
 * terminal.
 *
 * Why this matters: src/runner/confirmation.js opens /dev/tty and fails closed
 * when there is none. Before these ports existed, any hosted caller (a protocol
 * front end, an embedding process) silently had every write and shell approval
 * turned into a deny, with no error to explain it — the run just looked inert.
 *
 * These tests pin the three seams that make headless driving possible:
 *   1. onEvent          — subscribe to the scrubbed event stream, no stdout parsing
 *   2. confirm          — answer approvals without a terminal
 *   3. the kernel       — both survive the hand-written option whitelist
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const modelClient = require('../../src/runner/model-client');
const { run } = require('../../src/runner/run');
const { runKernel } = require('../../src/runner/kernel');

let tmpDir;
let originalPost;

/** Base options every test shares: no trust gate, no archive, no session file. */
function baseOptions(extra) {
  return {
    prompt: 'do the thing',
    cwd: tmpDir,
    model: 'test',
    maxTokens: 10,
    maxSteps: 3,
    skipTrustGate: true,
    quiet: true,
    noArchive: true,
    noSessionPersistence: true,
    ...extra,
  };
}

/** A model that asks to write one file, then answers. */
function stubWriteThenAnswer(fileName) {
  let call = 0;
  modelClient.post = async () => {
    call += 1;
    if (call === 1) {
      return {
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: 'write_file',
            input: { path: fileName, content: 'written by the model' },
          },
        ],
        stop_reason: 'tool_use',
      };
    }
    return { content: [{ type: 'text', text: 'finished' }] };
  };
}

describe('headless caller ports', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-headless-'));
    originalPost = modelClient.post;
  });

  afterEach(() => {
    modelClient.post = originalPost;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('onEvent receives the same events as the run buffer, including the terminal event', async () => {
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'hello there' }] });

    const seen = [];
    const result = await run(baseOptions({ onEvent: (event) => seen.push(event) }));

    assert.ok(seen.length > 0, 'subscriber received events');
    assert.deepEqual(
      seen.map((event) => event.type),
      result.events.map((event) => event.type),
      'subscriber sees exactly the run buffer, in order',
    );
    // Exactly one terminal event per run, and the subscriber must see it —
    // otherwise a hosted caller can never tell that a turn finished.
    const terminal = seen.filter((event) => event.type === 'result' || event.type === 'error');
    assert.equal(terminal.length, 1, 'exactly one terminal event reaches the subscriber');
  });

  it('an injected approval port lets a write happen with no terminal', async () => {
    stubWriteThenAnswer('allowed.txt');

    const asked = [];
    const result = await run(
      baseOptions({
        // write_file lives in the "edits" capability group, which is off unless
        // asked for; without this the tool is never offered and nothing asks.
        capabilities: ['edits'],
        confirm: {
          ask: async (proposedAction) => {
            asked.push(proposedAction);
            return 'allow';
          },
        },
      }),
    );

    assert.equal(asked.length, 1, 'the runner asked our port instead of the terminal');
    assert.equal(result.stopReason, 'success');
    assert.ok(fs.existsSync(path.join(tmpDir, 'allowed.txt')), 'the approved write actually happened');
  });

  it('an injected approval port can deny, and the write does not happen', async () => {
    stubWriteThenAnswer('denied.txt');

    let asked = 0;
    await run(
      baseOptions({
        capabilities: ['edits'],
        confirm: {
          ask: async () => {
            asked += 1;
            return 'deny';
          },
        },
      }),
    );

    // Assert the port was consulted, not just that no file exists — otherwise
    // this passes vacuously whenever the tool was never offered at all.
    assert.equal(asked, 1, 'the port was actually asked');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'denied.txt')), 'a denied write leaves no file behind');
  });

  it('omitted port methods fall back to the terminal implementation', async () => {
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'no tools needed' }] });

    // Supplying only ask must not blow up paths that call other port methods.
    const result = await run(baseOptions({ confirm: { ask: async () => 'allow' } }));
    assert.equal(result.stopReason, 'success');
  });

  it('a throwing subscriber cannot take the run down', async () => {
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'still fine' }] });

    const result = await run(
      baseOptions({
        onEvent: () => {
          throw new Error('subscriber exploded');
        },
      }),
    );

    // The run owns side effects on disk; it must finalize regardless of a
    // faulty subscriber.
    assert.equal(result.stopReason, 'success');
  });

  it('subscribers inherit redaction rather than needing their own scrubber', async () => {
    const secret = 'sk-ant-oat01-' + 'a'.repeat(40);
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'token is ' + secret }] });

    const seen = [];
    await run(baseOptions({ onEvent: (event) => seen.push(event) }));

    const serialized = JSON.stringify(seen);
    assert.ok(!serialized.includes(secret), 'no raw secret reaches a subscriber');
  });

  it('the kernel passes both ports through its option whitelist', async () => {
    stubWriteThenAnswer('kernel.txt');

    const seen = [];
    let askedViaKernel = 0;

    const result = await runKernel({
      prompt: 'do the thing',
      cwd: tmpDir,
      model: 'test',
      maxTokens: 10,
      maxSteps: 3,
      skipTrustGate: true,
      quiet: true,
      noArchive: true,
      noSessionPersistence: true,
      capabilities: ['edits'],
      onEvent: (event) => seen.push(event),
      confirm: {
        ask: async () => {
          askedViaKernel += 1;
          return 'allow';
        },
      },
    });

    assert.ok(result, 'kernel returned a result');
    assert.ok(seen.length > 0, 'onEvent survived the kernel adapter');
    assert.equal(askedViaKernel, 1, 'confirm survived the kernel adapter');
    assert.ok(fs.existsSync(path.join(tmpDir, 'kernel.txt')), 'the approved write happened via the kernel');
  });
});
