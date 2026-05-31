'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { HumanLog } = require('../../src/runner/human-log');

describe('human-readable runner log', () => {
  it('writes prompt, assistant text, tool requests, tool results, and final answer', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-log-'));
    const logPath = path.join(tmpDir, 'run.md');
    const log = new HumanLog(logPath);

    log.writeRunStart({ cwd: tmpDir, model: 'test-model', maxSteps: 3, outputFormat: 'text' });
    log.writeUserPrompt('Please inspect this.', 'Pasted file body');
    log.writeAssistant(1, {
      content: [
        { type: 'text', text: 'I will read a file.' },
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'README.md' } },
      ],
    });
    log.writeToolResult(1, 'read_file', 'tu1', { ok: true, text: '# README', bytes: 8 });
    log.writeFinal('Done.');

    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(text.includes('# Local Bridge Runner Log'));
    assert.ok(text.includes('Please inspect this.'));
    assert.ok(text.includes('Pasted file body'));
    assert.ok(text.includes('read_file'));
    assert.ok(text.includes('# README'));
    assert.ok(text.includes('Done.'));
  });

  it('scrubs secrets before writing plain text logs', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-log-redact-'));
    const logPath = path.join(tmpDir, 'run.md');
    const log = new HumanLog(logPath);
    const key = 'sk-ant-' + 'a'.repeat(30);

    log.writeToolResult(1, 'read_file', 'tu1', { ok: true, text: 'key=' + key });

    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(text.includes('[REDACTED:anthropic_key]'));
    assert.ok(!text.includes(key));
  });

  it('writes a Usage & Cost section', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'human-log-usage-'));
    const logPath = path.join(tmpDir, 'run.md');
    const log = new HumanLog(logPath);

    log.writeUsage({
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheCreationTokens: 0,
      cacheReadShare: 0.75,
      costUsd: 0.0012,
    });

    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(text.includes('## Usage & Cost'));
    assert.ok(text.includes('cache read share: 75%'));
    assert.ok(text.includes('~$0.0012'));
  });
});
