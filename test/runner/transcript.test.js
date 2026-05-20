'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Transcript, redactHeaders } = require('../../src/runner/transcript');

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
});
