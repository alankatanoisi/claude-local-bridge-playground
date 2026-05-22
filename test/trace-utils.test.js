'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonlTrace, bodySummary, captureForLevel, redactValue } = require('../src/trace-utils');

describe('trace utils', () => {
  it('keeps summary captures metadata-only', () => {
    const body = {
      model: 'claude-test',
      system: 'system prompt',
      messages: [{ role: 'user', content: 'private prompt' }],
      tools: [{ name: 'read_file' }],
    };

    const summary = bodySummary(body);
    assert.equal(summary.model, 'claude-test');
    assert.equal(summary.messages.count, 1);
    assert.equal(summary.tools_count, 1);
    assert.equal(captureForLevel('summary', body), undefined);
  });

  it('redacts auth fields and secret-looking text from payload captures', () => {
    const key = 'sk-ant-' + 'a'.repeat(30);
    const payload = redactValue({
      authorization: 'Bearer ' + key,
      nested: { text: 'token=' + key },
    });

    assert.equal(payload.authorization, '[REDACTED:key]');
    assert.ok(payload.nested.text.includes('[REDACTED]'));
    assert.ok(!JSON.stringify(payload).includes(key));
  });

  it('writes JSONL events for a local flight recorder', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-jsonl-'));
    const filePath = path.join(tmpDir, 'trace.jsonl');
    const trace = new JsonlTrace({ filePath, level: 'redacted', traceId: 'trace_test_123', layer: 'runner' });

    trace.append('tool_finished', {
      tool: 'read_file',
      result: trace.capture('Bearer ' + 'z'.repeat(30)),
    });

    const event = JSON.parse(fs.readFileSync(filePath, 'utf8').trim());
    assert.equal(event.type, 'tool_finished');
    assert.equal(event.trace_id, 'trace_test_123');
    assert.ok(event.result.includes('Bearer [REDACTED]'));
  });
});
