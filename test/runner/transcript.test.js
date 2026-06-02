'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Transcript, redactEvent, redactHeaders } = require('../../src/runner/transcript');

describe('transcript', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));

  it('redacts authorization headers', () => {
    const headers = { Authorization: 'Bearer sk-ant-secret-token-1234' };
    const redacted = redactHeaders(headers);
    assert.ok(!redacted.Authorization.includes('secret'));
    assert.ok(redacted.Authorization.includes('REDACTED'));
  });

  it('redacts x-api-key headers', () => {
    const headers = { 'x-api-key': 'sk-ant-api-key-5678' };
    const redacted = redactHeaders(headers);
    assert.ok(!redacted['x-api-key'].includes('api-key'));
  });

  it('leaves normal headers intact', () => {
    const headers = { 'content-type': 'application/json' };
    const redacted = redactHeaders(headers);
    assert.equal(redacted['content-type'], 'application/json');
  });

  it('redacts stable telemetry identifiers in headers and nested transcript events', () => {
    const stableId = '123e4567-e89b-42d3-a456-426614174000';
    const redacted = redactEvent({
      type: 'request',
      text: 'organization_uuid=' + stableId,
      headers: {
        'x-device-id': stableId,
        'x-local-bridge-run-id': 'run_debug_123',
      },
      request: {
        headers: {
          'x-session-id': stableId,
        },
      },
    });

    assert.equal(redacted.headers['x-device-id'], '[REDACTED:stable_identifier]');
    assert.equal(redacted.headers['x-local-bridge-run-id'], 'run_debug_123');
    assert.equal(redacted.request.headers['x-session-id'], '[REDACTED:stable_identifier]');
    assert.ok(redacted.text.includes('organization_uuid=[REDACTED:stable_identifier]'));
    assert.ok(!JSON.stringify(redacted).includes(stableId));
  });

  it('writes JSONL events', () => {
    const filePath = path.join(tmpDir, 'test.jsonl');
    const t = new Transcript(filePath);
    t.append({ type: 'user_prompt', text: 'hello' });
    t.writeFinal('done');

    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const ev1 = JSON.parse(lines[0]);
    assert.equal(ev1.type, 'user_prompt');
    const ev2 = JSON.parse(lines[1]);
    assert.equal(ev2.type, 'final');
    assert.equal(ev2.text, 'done');
  });

  it('creates missing directories', () => {
    const nestedDir = path.join(tmpDir, 'a', 'b');
    const filePath = path.join(nestedDir, 'log.jsonl');
    const t = new Transcript(filePath);
    t.append({ type: 'test' });
    assert.ok(fs.existsSync(nestedDir));
  });

  it('records a usage event with raw counts and derived fields', () => {
    const filePath = path.join(tmpDir, 'usage.jsonl');
    const t = new Transcript(filePath);
    t.writeFinal('done');
    t.recordUsage({
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheCreationTokens: 0,
      totalInputTokens: 400,
      costUsd: 0.0012,
      cacheReadShare: 0.75,
      oneLine: '[runner usage] in=100 out=50 cache_read=300 (reuse 75%) ~$0.0012',
    });

    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const usageEvent = lines.map((l) => JSON.parse(l)).find((e) => e.type === 'usage');
    assert.ok(usageEvent, 'usage event present');
    assert.equal(usageEvent.inputTokens, 100);
    assert.equal(usageEvent.cacheReadTokens, 300);
    assert.equal(usageEvent.costUsd, 0.0012);
    assert.equal(usageEvent.cacheReadShare, 0.75);
  });
});
