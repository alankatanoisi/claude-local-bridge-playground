'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const modelClient = require('../../src/runner/model-client');
const { run } = require('../../src/runner/run');

async function captureStdout(fn) {
  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

describe('runner output formats', () => {
  it('prints one parseable JSON object for outputFormat=json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-json-'));
    const originalPost = modelClient.post;
    modelClient.post = async () => ({
      content: [{ type: 'text', text: 'JSON final.' }],
      usage: { input_tokens: 3, output_tokens: 2 },
    });

    try {
      const stdout = await captureStdout(() =>
        run({
          prompt: 'final',
          cwd: tmpDir,
          model: 'test',
          maxTokens: 10,
          maxSteps: 2,
          outputFormat: 'json',
        }),
      );
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.finalText, 'JSON final.');
      assert.equal(parsed.usage.input_tokens, 3);
      assert.equal(parsed.usage.output_tokens, 2);
    } finally {
      modelClient.post = originalPost;
    }
  });

  it('prints parseable NDJSON events for outputFormat=stream-json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-ndjson-'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
    const originalPost = modelClient.post;
    let calls = 0;
    modelClient.post = async () => {
      calls++;
      if (calls === 1) {
        return {
          content: [{ type: 'tool_use', id: 'tu1', name: 'list_files', input: { path: '.' } }],
        };
      }
      return {
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    };

    try {
      const stdout = await captureStdout(() =>
        run({
          prompt: 'list',
          cwd: tmpDir,
          model: 'test',
          maxTokens: 10,
          maxSteps: 3,
          outputFormat: 'stream-json',
        }),
      );
      const events = stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(events.some((event) => event.type === 'system'));
      assert.ok(events.some((event) => event.type === 'tool_use'));
      assert.ok(events.some((event) => event.type === 'tool_result'));
      assert.ok(events.some((event) => event.type === 'result'));
    } finally {
      modelClient.post = originalPost;
    }
  });
});
