'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const modelClient = require('../../src/runner/model-client');
const { estimateRequest, updateCalibration, makePendingCalibration } = require('../../src/runner/context-estimator');
const { deriveContextPolicy } = require('../../src/runner/context-runtime-policy');
const { createContextState } = require('../../src/runner/session-anchor');
const { buildContextProjection, digestRawMessages } = require('../../src/runner/context-projection');
const { assertValidAnthropicMessages } = require('../../src/runner/message-contract');
const { SessionStore } = require('../../src/runner/session-store');
const { run } = require('../../src/runner/run');

const originalPost = modelClient.post;

function exchange(id, result, thinking) {
  return [
    { role: 'user', content: 'instruction ' + id },
    {
      role: 'assistant',
      content: [
        ...(thinking ? [thinking] : []),
        { type: 'tool_use', id: 'u' + id, name: 'read_file', input: { path: 'file-' + id + '.txt' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u' + id, content: result }] },
  ];
}

describe('complete request estimation and model policy', () => {
  it('counts every request surface and calibrates only a matched response', () => {
    const request = {
      system: [{ type: 'text', text: 'S'.repeat(100) }],
      tools: [{ name: 'x', input_schema: { type: 'object', properties: { value: { type: 'string' } } } }],
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'T'.repeat(100), signature: 'signed-bytes' },
            { type: 'redacted_thinking', data: 'R'.repeat(100) },
            { type: 'tool_use', id: 'u', name: 'x', input: { value: 'I'.repeat(100) } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'u', content: [{ type: 'text', text: 'A'.repeat(100) }] }],
        },
      ],
    };
    const estimate = estimateRequest(request, 1.5);
    assert.ok(estimate.uncalibratedTokens > 100, 'system, tools, thinking, inputs, and array results counted');
    const pending = makePendingCalibration(
      { requestId: 'r:1', runId: 'r', step: 1 },
      estimate,
      { factor: 1.5, samples: 0 },
      'claude-sonnet-5',
      'catalog',
    );
    const updated = updateCalibration({}, pending, {
      _contextRequest: { model: 'claude-sonnet-5', fingerprint: estimate.fingerprint },
      usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
    });
    assert.equal(updated.calibrationByModel['claude-sonnet-5'].samples, 1);
    assert.equal(
      updateCalibration(updated, pending, {
        _contextRequest: { model: 'other', fingerprint: estimate.fingerprint },
        usage: { input_tokens: 999 },
      }),
      updated,
      'model-mismatched sample ignored',
    );
  });

  it('derives 1M/200k ceilings, reserves output, and validates overrides', () => {
    const current = deriveContextPolicy({ model: 'claude-sonnet-5', maxTokens: 128_000 });
    assert.equal(current.contextWindow, 1_000_000);
    assert.equal(current.inputCeiling, 862_000);
    const older = deriveContextPolicy({ model: 'claude-sonnet-4-6', maxTokens: 64_000 });
    assert.equal(older.contextWindow, 200_000);
    assert.equal(older.inputCeiling, 126_000);
    assert.throws(
      () => deriveContextPolicy({ model: 'claude-sonnet-4-6', maxTokens: 64_001 }),
      /maximum response output/,
    );
  });
});

describe('raw-history request projection', () => {
  it('protects the recent semantic tail, signed thinking, system, and raw history', () => {
    const signed = { type: 'thinking', thinking: 'private reasoning bytes', signature: 'signed-exactly' };
    const raw = [{ role: 'user', content: 'OBJECTIVE MARKER ACCEPT_7F3C' }];
    for (let i = 0; i < 14; i++) raw.push(...exchange(i, String(i).repeat(30_000), i === 13 ? signed : null));
    const snapshot = JSON.stringify(raw);
    const system = [{ type: 'text', text: 'stable system' }];
    const policy = {
      ...deriveContextPolicy({ model: 'claude-sonnet-5', maxTokens: 2_000, compactAtTokens: 20_000 }),
      checkpoint: 35_000,
    };
    const state = createContextState('OBJECTIVE MARKER ACCEPT_7F3C');
    const projected = buildContextProjection({
      messages: raw,
      system,
      tools: [],
      policy,
      calibration: { factor: 1.5, samples: 0, lastObservedTokens: null },
      contextState: state,
      runtime: { tasks: [{ id: '1', status: 'in_progress', content: 'retain marker' }] },
    });
    assert.equal(JSON.stringify(raw), snapshot, 'canonical history is untouched');
    assert.deepEqual(system, [{ type: 'text', text: 'stable system' }], 'system bytes untouched');
    assertValidAnthropicMessages(projected.messages);
    assert.ok(
      JSON.stringify(projected.messages).includes('OBJECTIVE MARKER ACCEPT_7F3C'),
      'anchor preserves objective',
    );
    assert.ok(JSON.stringify(projected.messages).includes('signed-exactly'), 'retained signed block is byte-identical');
    for (let i = 6; i < 14; i++) {
      assert.ok(
        JSON.stringify(projected.messages).includes(String(i).repeat(30_000)),
        'protected recent result ' + i + ' remains byte-intact',
      );
    }
  });

  it('builds stable, non-recursive checkpoint epochs only from raw exchanges', () => {
    const raw = [{ role: 'user', content: 'objective' }];
    for (let i = 0; i < 20; i++) raw.push(...exchange(i, 'evidence-' + i));
    const first = digestRawMessages(raw, 30);
    const second = digestRawMessages(raw, 30);
    assert.deepEqual(first, second);
    assert.ok(!first.text.includes('[context:raw-checkpoint v1]\n[context:raw-checkpoint'), 'no summary-of-summary');
  });
});

describe('session migration and integrated raw persistence', () => {
  afterEach(() => {
    modelClient.post = originalPost;
  });

  it('labels structurally valid legacy compacted sessions without blocking them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-legacy-'));
    const file = path.join(dir, 'legacy.state.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'legacy',
        messages: [{ role: 'user', content: '[compaction:summarize] old retained state' }],
        runner: { compactionGeneration: 8 },
        metadata: {},
      }),
    );
    const store = new SessionStore(file);
    store.load();
    assert.equal(store.data().runner.contextState.historyQuality, 'legacy_compacted');
  });

  it('80-step large-read soak keeps every raw result while every projected request validates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-soak-'));
    const sessionPath = path.join(dir, 'soak.state.json');
    for (let index = 1; index <= 80; index++) {
      fs.writeFileSync(path.join(dir, 'large-' + index + '.txt'), 'SOAK_EVIDENCE_' + index + '_'.repeat(6_000));
    }
    const requests = [];
    let step = 0;
    modelClient.post = async (body) => {
      requests.push(body);
      assertValidAnthropicMessages(body.messages);
      step++;
      if (step <= 80) {
        return {
          id: 'm' + step,
          content: [
            { type: 'tool_use', id: 'read-' + step, name: 'read_file', input: { path: 'large-' + step + '.txt' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1_000, output_tokens: 10, cache_read_input_tokens: step * 50 },
        };
      }
      return {
        id: 'final',
        content: [{ type: 'text', text: 'SOAK_COMPLETE ACCEPTANCE_MARKER_80' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1_000, output_tokens: 10, cache_read_input_tokens: 4_000 },
      };
    };
    const result = await run({
      prompt: 'Retain ACCEPTANCE_MARKER_80 and read large.txt exactly 80 times.',
      cwd: dir,
      model: 'claude-sonnet-4-6',
      maxTokens: 256,
      maxSteps: 81,
      sessionPath,
      skipTrustGate: true,
      quiet: true,
      noArchive: true,
      compactAtTokens: 5_000,
      exposedTools: ['read_file'],
    });
    assert.equal(result.stopReason, 'success');
    assert.equal(requests.length, 81);
    assert.ok(requests.every((body) => JSON.stringify(body.system).includes('compaction:ghost') === false));
    const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const rawResults = stored.messages.flatMap((message) =>
      (Array.isArray(message.content) ? message.content : []).filter((block) => block.type === 'tool_result'),
    );
    assert.equal(rawResults.length, 80);
    assert.ok(rawResults.every((block) => String(block.content).includes('SOAK_EVIDENCE_')));
    assert.equal(stored.runner.health.recommendation, 'resume_ok');
    assert.equal(stored.runner.contextState.historyQuality, 'raw_complete');
  });
});
