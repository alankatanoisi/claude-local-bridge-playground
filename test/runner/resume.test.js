'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { loadMessagesFromTranscript } = require('../../src/runner/run');

describe('loadMessagesFromTranscript', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));

  it('returns null for missing file', () => {
    const result = loadMessagesFromTranscript(path.join(tmpDir, 'nonexistent.jsonl'));
    assert.equal(result, null);
  });

  it('loads a simple user-prompt + assistant transcript', () => {
    const filePath = path.join(tmpDir, 'simple.jsonl');
    const lines = [
      '{"type":"user_prompt","text":"Hello"}',
      '{"type":"request","step":1,"model":"test"}',
      '{"type":"assistant","step":1,"content":[{"type":"text","text":"Hi there"}]}',
      '{"type":"final","text":"Hi there"}',
    ];
    fs.writeFileSync(filePath, lines.join('\n'));

    const messages = loadMessagesFromTranscript(filePath);
    assert.notEqual(messages, null);
    assert.ok(messages.length >= 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, 'Hello');
  });

  it('loads a conversation with tool calls', () => {
    const filePath = path.join(tmpDir, 'tools.jsonl');
    const lines = [
      '{"type":"user_prompt","text":"What files are here?"}',
      '{"type":"request","step":1,"model":"test"}',
      '{"type":"assistant","step":1,"content":[{"type":"text","text":"Let me check"},{"type":"tool_use","id":"tu1","name":"list_files","input":{"path":"."}}]}',
      '{"type":"tool_call","step":1,"tool":"list_files","args":{"path":"."},"toolUseId":"tu1"}',
      '{"type":"tool_result","step":1,"tool":"list_files","ok":true,"bytes":30,"toolUseId":"tu1"}',
      '{"type":"request","step":2,"model":"test"}',
      '{"type":"assistant","step":2,"content":[{"type":"text","text":"I see app.js"}]}',
      '{"type":"final","text":"I see app.js"}',
    ];
    fs.writeFileSync(filePath, lines.join('\n'));

    const messages = loadMessagesFromTranscript(filePath);
    assert.notEqual(messages, null);
    // Should have at least user message, assistant with tool_use, tool_result user message
    assert.ok(messages.length >= 2);
    assert.equal(messages[0].role, 'user');
  });

  it('strips final assistant turn for resume (leaves last user message)', () => {
    const filePath = path.join(tmpDir, 'last-user.jsonl');
    const lines = [
      '{"type":"user_prompt","text":"First question"}',
      '{"type":"assistant","step":1,"content":[{"type":"text","text":"Answer 1"}]}',
    ];
    fs.writeFileSync(filePath, lines.join('\n'));

    const messages = loadMessagesFromTranscript(filePath);
    assert.notEqual(messages, null);
    // The last message should be the user message (final assistant stripped)
    const last = messages[messages.length - 1];
    assert.equal(last.role, 'user');
  });
});
