'use strict';

/**
 * acp-agent.test.js — Slice B acceptance: a test client completes full turns
 * against the REAL runner over ACP (Agent Client Protocol), including an
 * approval round trip with allow, deny, and cancel outcomes.
 *
 * The model is stubbed at the same seam the headless-ports tests use
 * (modelClient.post), so no network and no credentials are involved — but
 * everything between the protocol socket and the model call is the real code:
 * connection, agent translation, run(), permission gate, tool execution,
 * session checkpoints, redaction.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const path = require('path');
const os = require('os');
const fs = require('fs');

const modelClient = require('../../src/runner/model-client');
const { run } = require('../../src/runner/run');
const { encodeLine } = require('../../src/runner/acp/ndjson');
const { createAcpAgent, toolKindFor, acpStopReasonFor, promptTextFrom } = require('../../src/runner/acp/agent');
const { STOP_REASONS } = require('../../src/runner/kernel/contract');

let tmpDir; // the session cwd the runner works in
let sessionDir; // where checkpoints land (never the real ~/.bridge-runner)
let originalPost;
let originalPostStream;

/**
 * Slice D: the agent always runs with stream: true, so run() calls
 * modelClient.postStream. Mirror whatever modelClient.post is stubbed to do,
 * additionally emitting each text block as TWO text deltas split mid-string —
 * the cruelest boundary for the streaming scrubber — before resolving the same
 * response shape post() returns.
 */
function installPostStreamMirror() {
  modelClient.postStream = async (body, cb) => {
    const response = await modelClient.post(body);
    if (typeof cb === 'function') {
      for (const block of response.content || []) {
        if (block && block.type === 'text' && block.text) {
          const mid = Math.ceil(block.text.length / 2);
          cb({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block.text.slice(0, mid) } });
          cb({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block.text.slice(mid) } });
        }
      }
    }
    return response;
  };
}

/**
 * A minimal in-memory ACP client. It talks to the agent through PassThrough
 * streams exactly as T3 would through pipes: requests out, responses and
 * session/update notifications in, and it answers the agent's own
 * session/request_permission requests via a registered handler.
 */
function createTestClient(options = {}) {
  const toAgent = new PassThrough();
  const updates = []; // every session/update params we received
  const permissionRequests = []; // every session/request_permission params
  const askQuestionRequests = []; // every cursor/ask_question params
  const pending = new Map(); // our request id → {resolve, reject}
  let permissionHandler = options.onPermission || null;
  let askQuestionHandler = options.onAskQuestion || null;
  let nextId = 1;

  const agent = createAcpAgent({
    input: toAgent,
    write: (line) => deliver(JSON.parse(line)),
    runFn: options.runFn || run,
    sessionDir,
    version: 'test',
    configDefaults: options.configDefaults,
    // skipTrustGate is the sanctioned test-injection path (run.js documents
    // it); noArchive keeps test runs out of the real archive directory.
    runDefaults: { skipTrustGate: true, noArchive: true, maxSteps: 4, ...options.runDefaults },
  });

  function deliver(message) {
    // The agent is calling US (only session/request_permission does this).
    if (message.method && message.id !== undefined) {
      if (message.method === 'session/request_permission') {
        permissionRequests.push(message.params);
        Promise.resolve()
          .then(() => (permissionHandler ? permissionHandler(message.params) : { outcome: { outcome: 'cancelled' } }))
          .then((result) => toAgent.write(encodeLine({ jsonrpc: '2.0', id: message.id, result })));
        return;
      }
      // cursor/ask_question (T3's question card). With no handler installed we
      // fall through to the -32601 rejection below — exactly what a non-T3
      // client would answer, which is the fallback path under test.
      if (message.method === 'cursor/ask_question' && askQuestionHandler) {
        askQuestionRequests.push(message.params);
        Promise.resolve()
          .then(() => askQuestionHandler(message.params))
          .then((result) => toAgent.write(encodeLine({ jsonrpc: '2.0', id: message.id, result })));
        return;
      }
      toAgent.write(
        encodeLine({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'client cannot ' + message.method },
        }),
      );
      return;
    }
    if (message.method) {
      if (message.method === 'session/update') updates.push(message.params);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      const err = new Error(message.error.message);
      err.code = message.error.code;
      err.data = message.error.data;
      waiter.reject(err);
    } else {
      waiter.resolve(message.result);
    }
  }

  return {
    agent,
    updates,
    permissionRequests,
    askQuestionRequests,
    setPermissionHandler(fn) {
      permissionHandler = fn;
    },
    setAskQuestionHandler(fn) {
      askQuestionHandler = fn;
    },
    request(method, params) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        toAgent.write(encodeLine({ jsonrpc: '2.0', id, method, params }));
      });
    },
    notify(method, params) {
      toAgent.write(encodeLine({ jsonrpc: '2.0', method, params }));
    },
    async startSession() {
      await this.request('initialize', { protocolVersion: 1 });
      const created = await this.request('session/new', { cwd: tmpDir, mcpServers: [] });
      return created.sessionId;
    },
    prompt(sessionId, text) {
      return this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
    },
  };
}

/** A model that asks to write one file, then answers with plain text. */
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

const ALLOW = { outcome: { outcome: 'selected', optionId: 'allow-once' } };
const DENY = { outcome: { outcome: 'selected', optionId: 'reject-once' } };

describe('acp agent over the real runner', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-agent-cwd-'));
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-agent-sessions-'));
    originalPost = modelClient.post;
    originalPostStream = modelClient.postStream;
    installPostStreamMirror();
  });

  afterEach(() => {
    modelClient.post = originalPost;
    modelClient.postStream = originalPostStream;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(sessionDir, { recursive: true, force: true });
    // Cancelled runs set process.exitCode = 1; reset so the test file's own
    // exit status reflects assertions, not deliberate cancels (same precedent
    // as agent-loop.test.js).
    process.exitCode = 0;
  });

  it('initialize reports the protocol version, identity, and capabilities', async () => {
    const client = createTestClient();
    const result = await client.request('initialize', { protocolVersion: 1 });
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.agentInfo.name, 'bridge-runner-acp');
    assert.equal(result.agentCapabilities.loadSession, true);
  });

  it('rejects session/new before initialize, and relative cwds after it', async () => {
    const client = createTestClient();
    await assert.rejects(client.request('session/new', { cwd: tmpDir, mcpServers: [] }), /initialize/);
    await client.request('initialize', { protocolVersion: 1 });
    await assert.rejects(client.request('session/new', { cwd: 'not/absolute', mcpServers: [] }), /absolute/);
  });

  it('answers an unknown method with a JSON-RPC error instead of hanging', async () => {
    const client = createTestClient();
    await assert.rejects(client.request('session/no_such_thing', {}), (err) => {
      assert.equal(err.code, -32601);
      return true;
    });
  });

  it('session/new returns a session id and the composer config options', async () => {
    const client = createTestClient();
    await client.request('initialize', { protocolVersion: 1 });
    const created = await client.request('session/new', { cwd: tmpDir, mcpServers: [] });
    assert.ok(created.sessionId);
    const ids = created.configOptions.map((o) => o.id);
    assert.ok(ids.includes('model') && ids.includes('effort') && ids.includes('context') && ids.includes('mode'));
    assert.ok(ids.includes('capability_edits'), 'capability groups are boolean toggles');
    assert.ok(!ids.includes('capability_shell'), 'shell must never be a composer toggle');
    for (const option of created.configOptions) {
      assert.ok(option.type === 'select' || option.type === 'boolean', 'ACP only renders select/boolean');
    }
  });

  it('a text-only turn streams agent_message_chunk and ends with end_turn', async () => {
    // Two lines: the streaming scrubber is line-aligned (it holds a partial
    // line until its newline arrives), so multi-line text is what proves the
    // client received LIVE deltas rather than one end-of-turn blob.
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'hello from the bridge\nsecond line' }] });
    const client = createTestClient();
    const sessionId = await client.startSession();

    const response = await client.prompt(sessionId, 'say hello');

    assert.equal(response.stopReason, 'end_turn');
    const chunks = client.updates.filter((u) => u.update.sessionUpdate === 'agent_message_chunk');
    const joined = chunks.map((u) => u.update.content.text).join('');
    assert.equal(joined, 'hello from the bridge\nsecond line', 'streamed deltas reassemble the text exactly once');
    assert.ok(chunks.length >= 2, 'text arrived as live streamed deltas, not one buffered blob');
    assert.ok(
      client.updates.every((u) => u.sessionId === sessionId),
      'every update names the session',
    );
  });

  it('an allowed approval round trip executes the write and reports the tool lifecycle', async () => {
    stubWriteThenAnswer('allowed.txt');
    const client = createTestClient({ onPermission: () => ALLOW });
    const sessionId = await client.startSession();
    await client.request('session/set_config_option', { sessionId, configId: 'capability_edits', value: true });

    const response = await client.prompt(sessionId, 'write the file');

    assert.equal(response.stopReason, 'end_turn');
    assert.ok(fs.existsSync(path.join(tmpDir, 'allowed.txt')), 'the approved write actually happened');

    // The permission card carried the tool identity and a human title.
    assert.equal(client.permissionRequests.length, 1);
    const permission = client.permissionRequests[0];
    assert.equal(permission.sessionId, sessionId);
    assert.equal(permission.toolCall.toolCallId, 'tu-1');
    assert.equal(permission.toolCall.kind, 'edit');
    assert.ok(permission.toolCall.title, 'a human-readable proposed action is shown');
    assert.deepEqual(
      permission.options.map((o) => o.optionId),
      ['allow-once', 'allow-always', 'reject-once'],
      'T3 hard-codes these reply ids, so the advertised ids must match exactly',
    );
    assert.deepEqual(
      permission.options.map((o) => o.kind),
      ['allow_once', 'allow_always', 'reject_once'],
    );

    // Tool lifecycle: a tool_call card, then its completion update.
    const toolCalls = client.updates.filter((u) => u.update.sessionUpdate === 'tool_call');
    const toolUpdates = client.updates.filter((u) => u.update.sessionUpdate === 'tool_call_update');
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].update.toolCallId, 'tu-1');
    assert.equal(toolCalls[0].update.kind, 'edit');
    assert.equal(toolUpdates.length, 1);
    assert.equal(toolUpdates[0].update.toolCallId, 'tu-1');
    assert.equal(toolUpdates[0].update.status, 'completed');
  });

  it('a denied approval leaves no file and marks the tool call failed', async () => {
    stubWriteThenAnswer('denied.txt');
    const client = createTestClient({ onPermission: () => DENY });
    const sessionId = await client.startSession();
    await client.request('session/set_config_option', { sessionId, configId: 'capability_edits', value: true });

    const response = await client.prompt(sessionId, 'write the file');

    // The port must actually have been consulted — otherwise "no file" passes
    // vacuously when the tool was never offered (same trap the headless-ports
    // tests document).
    assert.equal(client.permissionRequests.length, 1, 'the approval question reached the client');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'denied.txt')), 'a denied write leaves no file behind');
    const toolUpdates = client.updates.filter((u) => u.update.sessionUpdate === 'tool_call_update');
    assert.equal(toolUpdates[0].update.status, 'failed');
    assert.equal(response.stopReason, 'end_turn');
  });

  it('allow-always answers the current ask and silences later cards for the session', async () => {
    // Two writes in one turn: the first card is answered "always allow"; the
    // second write must then run with NO second card.
    let call = 0;
    modelClient.post = async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: 'one.txt', content: '1' } },
            { type: 'tool_use', id: 'tu-2', name: 'write_file', input: { path: 'two.txt', content: '2' } },
          ],
          stop_reason: 'tool_use',
        };
      }
      return { content: [{ type: 'text', text: 'done' }] };
    };
    const client = createTestClient({
      onPermission: () => ({ outcome: { outcome: 'selected', optionId: 'allow-always' } }),
    });
    const sessionId = await client.startSession();
    await client.request('session/set_config_option', { sessionId, configId: 'capability_edits', value: true });

    const response = await client.prompt(sessionId, 'write both');

    assert.equal(client.permissionRequests.length, 1, 'the second write asked no new card');
    assert.ok(fs.existsSync(path.join(tmpDir, 'one.txt')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'two.txt')));
    assert.equal(response.stopReason, 'end_turn');
  });

  it('a cancelled permission outcome reports the turn as cancelled', async () => {
    stubWriteThenAnswer('cancelled.txt');
    const client = createTestClient({ onPermission: () => ({ outcome: { outcome: 'cancelled' } }) });
    const sessionId = await client.startSession();
    await client.request('session/set_config_option', { sessionId, configId: 'capability_edits', value: true });

    const response = await client.prompt(sessionId, 'write the file');

    assert.equal(response.stopReason, 'cancelled');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'cancelled.txt')), 'the cancelled write never happened');
  });

  it('session/cancel denies the remaining approvals of the turn without asking again', async () => {
    // One model response asking for TWO writes: the serial write loop asks
    // approval for each in order, so a cancel delivered while answering the
    // first must auto-deny the second with no second permission card.
    let call = 0;
    modelClient.post = async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: 'first.txt', content: 'one' } },
            { type: 'tool_use', id: 'tu-2', name: 'write_file', input: { path: 'second.txt', content: 'two' } },
          ],
          stop_reason: 'tool_use',
        };
      }
      return { content: [{ type: 'text', text: 'done' }] };
    };

    const client = createTestClient();
    const sessionId = await client.startSession();
    await client.request('session/set_config_option', { sessionId, configId: 'capability_edits', value: true });
    client.setPermissionHandler(() => {
      // The user hits Stop while the first card is open: the cancel arrives
      // before the (already-granted) answer.
      client.notify('session/cancel', { sessionId });
      return ALLOW;
    });

    const response = await client.prompt(sessionId, 'write both files');

    assert.equal(client.permissionRequests.length, 1, 'the second write never produced a card');
    assert.ok(fs.existsSync(path.join(tmpDir, 'first.txt')), 'the explicitly allowed write still happened');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'second.txt')), 'the post-cancel write was denied');
    assert.equal(response.stopReason, 'cancelled');
  });

  it('a cancelled session stays alive: the next prompt on the same session succeeds', async () => {
    // Slice D acceptance at the protocol level. Turn 1 is cancelled mid-flight
    // (the cancel arrives while the model call is in the air); the response is
    // discarded before it can pollute the checkpoint, and turn 2 runs cleanly
    // on the SAME session with resume.
    let call = 0;
    const client = createTestClient();
    const sessionId = await client.startSession();

    modelClient.post = async () => {
      call += 1;
      if (call === 1) {
        // The user hits Stop while this response is being generated.
        client.notify('session/cancel', { sessionId });
        // Give the notification a tick to be dispatched before we "arrive".
        await new Promise((resolve) => setImmediate(resolve));
        return {
          content: [{ type: 'tool_use', id: 'tu-1', name: 'write_file', input: { path: 'never.txt', content: 'no' } }],
          stop_reason: 'tool_use',
        };
      }
      return { content: [{ type: 'text', text: 'second turn answer' }] };
    };

    const first = await client.prompt(sessionId, 'long doomed turn');
    assert.equal(first.stopReason, 'cancelled');
    // M3 (2026-08-25): the hosted agent opts out of CLI exit-code semantics,
    // so a cancelled turn must not leave exitCode=1 stuck on the process.
    assert.ok(!process.exitCode, 'a cancelled ACP turn does not poison process.exitCode');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'never.txt')), 'the cancelled turn started no side effect');
    assert.equal(client.permissionRequests.length, 0, 'no approval card for a discarded response');

    const second = await client.prompt(sessionId, 'are you still there?');
    assert.equal(second.stopReason, 'end_turn', 'the session survived the cancel');
    const texts = client.updates
      .filter((u) => u.update.sessionUpdate === 'agent_message_chunk')
      .map((u) => u.update.content.text)
      .join('');
    assert.ok(texts.includes('second turn answer'));
  });

  it('subscribing over ACP inherits redaction — no raw secret crosses the wire', async () => {
    const secret = 'sk-ant-oat01-' + 'a'.repeat(40);
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'token is ' + secret }] });

    const wire = [];
    const client = createTestClient();
    // Watch the raw frames, not just parsed updates: the assertion must cover
    // everything the agent writes.
    const originalUpdates = client.updates;
    const sessionId = await client.startSession();
    await client.prompt(sessionId, 'leak something');
    wire.push(JSON.stringify(originalUpdates));

    assert.ok(!wire.join('').includes(secret), 'the redaction boundary held across the protocol');
  });

  it('config options change what the runner is called with', async () => {
    const captured = [];
    const stubRun = async (options) => {
      captured.push(options);
      return {
        stopReason: STOP_REASONS.SUCCESS,
        finalText: 'ok',
        steps: 1,
        duration_ms: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        events: [],
      };
    };
    const client = createTestClient({ runFn: stubRun });
    const sessionId = await client.startSession();

    await client.request('session/set_config_option', { sessionId, configId: 'model', value: 'claude-haiku-4-5' });
    await client.request('session/set_config_option', { sessionId, configId: 'effort', value: 'low' });
    await client.request('session/set_config_option', { sessionId, configId: 'context', value: '8192' });
    await client.request('session/set_config_option', { sessionId, configId: 'capability_edits', value: true });
    await client.prompt(sessionId, 'first');

    assert.equal(captured[0].model, 'claude-haiku-4-5');
    assert.equal(captured[0].effort, 'low');
    assert.equal(captured[0].maxTokens, 8192);
    assert.deepEqual(captured[0].capabilities, ['edits']);
    assert.equal(captured[0].resume, false, 'the first turn starts fresh');

    await client.prompt(sessionId, 'second');
    assert.equal(captured[1].resume, true, 'later turns resume the checkpoint');

    // Invalid values are rejected at the protocol boundary, not passed through.
    await assert.rejects(
      client.request('session/set_config_option', { sessionId, configId: 'model', value: 'gpt-oops' }),
      /Unknown model/,
    );
    await assert.rejects(
      client.request('session/set_config_option', { sessionId, configId: 'capability_shell', value: true }),
      /Unknown capability toggle/,
    );
  });

  it('a second turn really resumes: the model sees the first turn in its transcript', async () => {
    const bodies = [];
    modelClient.post = async (body) => {
      bodies.push(body);
      return { content: [{ type: 'text', text: 'reply ' + bodies.length }] };
    };
    const client = createTestClient();
    const sessionId = await client.startSession();

    await client.prompt(sessionId, 'remember the word pineapple');
    await client.prompt(sessionId, 'what was the word?');

    const lastBody = bodies[bodies.length - 1];
    const serialized = JSON.stringify(lastBody.messages);
    assert.ok(serialized.includes('pineapple'), 'turn 2 carried turn 1 conversation to the model');
    assert.ok(lastBody.messages.length > bodies[0].messages.length, 'the transcript grew across turns');
  });

  it('session/load accepts a real checkpoint and rejects an unknown id', async () => {
    modelClient.post = async () => ({ content: [{ type: 'text', text: 'checkpointed' }] });
    const client = createTestClient();
    const sessionId = await client.startSession();
    await client.prompt(sessionId, 'create a checkpoint');

    // A fresh client (fresh process in real life) loads the same session.
    const client2 = createTestClient();
    await client2.request('initialize', { protocolVersion: 1 });
    const loaded = await client2.request('session/load', { sessionId, cwd: tmpDir, mcpServers: [] });
    assert.ok(Array.isArray(loaded.configOptions));

    await assert.rejects(
      client2.request('session/load', { sessionId: 'ses_does-not-exist', cwd: tmpDir, mcpServers: [] }),
      /No session checkpoint/,
    );
  });

  it('rejects a second concurrent prompt instead of multiplexing runs', async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const stubRun = async () => {
      await gate;
      return {
        stopReason: STOP_REASONS.SUCCESS,
        finalText: 'ok',
        steps: 1,
        duration_ms: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        events: [],
      };
    };
    const client = createTestClient({ runFn: stubRun });
    const sessionId = await client.startSession();

    const first = client.prompt(sessionId, 'long turn');
    await assert.rejects(client.prompt(sessionId, 'impatient second turn'), /already running/);
    release();
    const response = await first;
    assert.equal(response.stopReason, 'end_turn');
  });

  it('serves the Cursor host: model probe, set_model, and mode semantics', async () => {
    const captured = [];
    const stubRun = async (options) => {
      captured.push(options);
      return {
        stopReason: STOP_REASONS.SUCCESS,
        finalText: 'ok',
        steps: 1,
        duration_ms: 1,
        usage: { input_tokens: 0, output_tokens: 0 },
        events: [],
      };
    };
    const client = createTestClient({ runFn: stubRun });
    const sessionId = await client.startSession();

    // The Cursor driver's model catalogue probe: every model carries the
    // composer knobs, and only select/boolean shapes are allowed.
    const catalogue = await client.request('cursor/list_available_models', {});
    assert.equal(catalogue.models.length, 4);
    for (const model of catalogue.models) {
      assert.ok(model.value && model.name);
      const knobIds = model.configOptions.map((o) => o.id);
      assert.deepEqual(knobIds, ['effort', 'context'], 'the field-verified Cursor knob ids');
    }

    // Model changes arrive via the dedicated method, not a config option.
    await client.request('session/set_model', { sessionId, modelId: 'claude-fable-5' });
    await assert.rejects(client.request('session/set_model', { sessionId, modelId: 'gpt-oops' }), /Unknown model/);

    // plan mode → the runner's plan flag (propose, never execute).
    await client.request('session/set_config_option', { sessionId, configId: 'mode', value: 'plan' });
    await client.prompt(sessionId, 'plan something');
    assert.equal(captured[0].model, 'claude-fable-5');
    assert.equal(captured[0].plan, true);
    assert.equal(captured[0].acceptEdits, undefined);

    // code mode via the Cursor mode-toggle extension → acceptEdits, and the
    // agent confirms the switch with a current_mode_update.
    await client.request('session/mode/set', { sessionId, modeId: 'code' });
    const modeUpdates = client.updates.filter((u) => u.update.sessionUpdate === 'current_mode_update');
    assert.equal(modeUpdates.length, 1);
    assert.equal(modeUpdates[0].update.currentModeId, 'code');
    await client.prompt(sessionId, 'implement it');
    assert.equal(captured[1].plan, undefined);
    assert.equal(captured[1].acceptEdits, true);

    await assert.rejects(client.request('session/mode/set', { sessionId, modeId: 'yolo' }), /Unknown mode/);
  });

  it('an errored run surfaces as a JSON-RPC error with the runner explanation', async () => {
    const stubRun = async () => ({
      stopReason: STOP_REASONS.BRIDGE_ERROR,
      finalText: 'Bridge request failed: connection refused',
      steps: 0,
      duration_ms: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
      events: [],
    });
    const client = createTestClient({ runFn: stubRun });
    const sessionId = await client.startSession();
    await assert.rejects(client.prompt(sessionId, 'anything'), (err) => {
      assert.match(err.message, /connection refused/);
      assert.equal(err.data.stopReason, STOP_REASONS.BRIDGE_ERROR);
      return true;
    });
  });

  // ── ask_user_question over ACP (R4, 2026-08-31) ──────────────────────────

  /**
   * A model that asks one multiple-choice question, then answers with whatever
   * tool_result text it got back — so assertions read the exact string the
   * model would see. Captures each request body for deeper inspection.
   */
  function stubAskThenEcho(bodies) {
    modelClient.post = async (body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu-ask-1',
              name: 'ask_user_question',
              input: {
                question: 'Which color should the widget be?',
                header: 'Widget color',
                options: [{ label: 'Red' }, { label: 'Blue', description: 'the calm choice' }, { label: 'Green' }],
              },
            },
          ],
          stop_reason: 'tool_use',
        };
      }
      const lastMessage = body.messages[body.messages.length - 1];
      const toolResult = Array.isArray(lastMessage.content)
        ? lastMessage.content.find((b) => b && b.type === 'tool_result')
        : null;
      const echoed = toolResult ? String(toolResult.content) : '(no tool_result)';
      return { content: [{ type: 'text', text: 'model saw: ' + echoed }] };
    };
    installPostStreamMirror();
  }

  it('ask_user_question rides the cursor/ask_question card and returns the selection', async () => {
    const bodies = [];
    stubAskThenEcho(bodies);
    const client = createTestClient({
      onAskQuestion: (params) => {
        // Answer with the option ID to prove id→label mapping on the way back.
        const q = params.questions[0];
        return { answers: { [q.id]: [q.options[1].id] } };
      },
    });
    const sessionId = await client.startSession();

    const response = await client.prompt(sessionId, 'make me a widget');

    assert.equal(response.stopReason, 'end_turn');
    // The wire request matched T3's CursorAskQuestionRequest shape.
    assert.equal(client.askQuestionRequests.length, 1);
    const wire = client.askQuestionRequests[0];
    assert.equal(wire.toolCallId, 'tu-ask-1', 'card correlates to the real tool_use id');
    assert.equal(wire.title, 'Widget color');
    assert.equal(wire.questions.length, 1);
    assert.equal(wire.questions[0].prompt, 'Which color should the widget be?');
    assert.deepEqual(
      wire.questions[0].options.map((o) => o.id),
      ['opt-1', 'opt-2', 'opt-3'],
    );
    assert.match(wire.questions[0].options[1].label, /Blue — the calm choice/);
    // The model got the human-readable selection back as its tool_result.
    assert.match(bodies[1].messages[bodies[1].messages.length - 1].content[0].content, /User selected: Blue/);
  });

  it('a dismissed question card fails closed with an explanation, not a hang', async () => {
    const bodies = [];
    stubAskThenEcho(bodies);
    const client = createTestClient({
      onAskQuestion: () => ({ answers: {} }), // T3 settles empty answers on dismiss/cancel
    });
    const sessionId = await client.startSession();

    const response = await client.prompt(sessionId, 'make me a widget');

    assert.equal(response.stopReason, 'end_turn');
    const toolResult = bodies[1].messages[bodies[1].messages.length - 1].content[0];
    assert.equal(toolResult.is_error, true);
    assert.match(String(toolResult.content), /dismissed the question/);
  });

  it('a client without the question method gets the safe fallback text', async () => {
    const bodies = [];
    stubAskThenEcho(bodies);
    // No onAskQuestion handler: the test client answers -32601 method-not-found,
    // exactly like a non-T3 ACP client.
    const client = createTestClient();
    const sessionId = await client.startSession();

    const response = await client.prompt(sessionId, 'make me a widget');

    assert.equal(response.stopReason, 'end_turn');
    assert.equal(client.askQuestionRequests.length, 0);
    const toolResult = bodies[1].messages[bodies[1].messages.length - 1].content[0];
    assert.equal(toolResult.is_error, true);
    assert.match(String(toolResult.content), /not supported by this ACP client/);
    assert.match(String(toolResult.content), /best safe assumption/);
  });

  it('answers keyed by prompt text (not id) and given as labels still resolve', async () => {
    const bodies = [];
    stubAskThenEcho(bodies);
    const client = createTestClient({
      onAskQuestion: (params) => ({
        answers: { [params.questions[0].prompt]: 'Green' },
      }),
    });
    const sessionId = await client.startSession();

    await client.prompt(sessionId, 'make me a widget');

    assert.match(bodies[1].messages[bodies[1].messages.length - 1].content[0].content, /User selected: Green/);
  });
});

describe('acp translation helpers', () => {
  it('maps tool names to ACP tool kinds from the catalog categories', () => {
    assert.equal(toolKindFor('read_file'), 'read');
    assert.equal(toolKindFor('search_text'), 'search');
    assert.equal(toolKindFor('glob'), 'search');
    assert.equal(toolKindFor('write_file'), 'edit');
    assert.equal(toolKindFor('undo'), 'edit');
    assert.equal(toolKindFor('bash'), 'execute');
    assert.equal(toolKindFor('ask_user_question'), 'other');
    assert.equal(toolKindFor('something_unknown'), 'other');
  });

  it('maps runner stop reasons onto the five ACP prompt stop reasons', () => {
    assert.equal(acpStopReasonFor(STOP_REASONS.SUCCESS, false), 'end_turn');
    assert.equal(acpStopReasonFor(STOP_REASONS.SUCCESS, true), 'cancelled');
    assert.equal(acpStopReasonFor(STOP_REASONS.CANCELLED, false), 'cancelled');
    assert.equal(acpStopReasonFor(STOP_REASONS.MODEL_REFUSAL, false), 'refusal');
    assert.equal(acpStopReasonFor(STOP_REASONS.MAX_STEPS, false), 'max_turn_requests');
    assert.equal(acpStopReasonFor(STOP_REASONS.MAX_TOOL_CALLS_PER_TURN, false), 'max_turn_requests');
    assert.equal(acpStopReasonFor(STOP_REASONS.MODEL_MAX_TOKENS, false), 'max_tokens');
    assert.equal(acpStopReasonFor(STOP_REASONS.CONTEXT_BUDGET_EXCEEDED, false), 'max_tokens');
    assert.equal(acpStopReasonFor(STOP_REASONS.USER_DENIED, false), 'end_turn');
  });

  it('extracts prompt text from ACP content blocks', () => {
    assert.equal(
      promptTextFrom([
        { type: 'text', text: 'fix the bug' },
        { type: 'resource_link', uri: 'file:///tmp/app.js', name: 'app.js' },
        { type: 'image', data: 'ignored' },
      ]),
      'fix the bug\n\n[resource] file:///tmp/app.js',
    );
    assert.equal(promptTextFrom([]), '');
    assert.equal(promptTextFrom(null), '');
  });
});
