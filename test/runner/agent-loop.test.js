'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const modelClient = require('../../src/runner/model-client');
const confirm = require('../../src/runner/confirmation');
const { run, extractTextBlocks, extractToolUses, applyCacheControlBudget } = require('../../src/runner/run');

describe('run helpers', () => {
  it('extractTextBlocks joins text blocks', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: '1', name: 'x', input: {} },
      { type: 'text', text: 'world' },
    ];
    assert.equal(extractTextBlocks(content), 'Hello\nworld');
  });

  it('extractToolUses returns only tool_use blocks', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: '1', name: 'list_files', input: {} },
    ];
    const tools = extractToolUses(content);
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'list_files');
  });

  it('applies cache_control only to the system prompt', () => {
    const tools = Array.from({ length: 10 }, (_, index) => ({
      name: 'tool_' + index,
      description: 'test tool',
      input_schema: { type: 'object', properties: {} },
    }));

    const { cachedSystem, cachedTools } = applyCacheControlBudget('system prompt', tools);

    assert.equal(cachedSystem[0].cache_control.type, 'ephemeral');
    assert.equal(cachedTools.filter((tool) => tool.cache_control).length, 0);
  });

  it('handles cache_read and cache_creation in addUsage', () => {
    const { addUsage } = require('../../src/runner/run');
    const total = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const usage = {
      input_tokens: 200,
      output_tokens: 100,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 80,
    };
    const result = addUsage(total, usage);
    assert.equal(result.input_tokens, 300);
    assert.equal(result.output_tokens, 150);
    assert.equal(result.cache_read_input_tokens, 500);
    assert.equal(result.cache_creation_input_tokens, 80);
  });
});

describe('agent loop — read-only', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-'));
  fs.writeFileSync(path.join(tmpDir, 'hello.js'), 'console.log("hi");\n');

  it('final answer on first response', async () => {
    const originalPost = modelClient.post;
    modelClient.post = async () => ({
      content: [{ type: 'text', text: 'The answer is 42.' }],
    });

    try {
      let logged = '';
      const originalLog = console.log;
      console.log = (msg) => {
        logged += msg;
      };

      await run({
        prompt: 'What is the answer?',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        transcriptPath: path.join(tmpDir, 'final.jsonl'),
      });

      console.log = originalLog;
      assert.ok(logged.includes('42'));
    } finally {
      modelClient.post = originalPost;
    }
  });

  it('writes a human-readable log when humanLogPath is provided', async () => {
    const originalPost = modelClient.post;
    const humanLogPath = path.join(tmpDir, 'human-log.md');
    modelClient.post = async () => ({
      content: [{ type: 'text', text: 'Human log answer.' }],
    });

    try {
      await run({
        prompt: 'Log this run',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 2,
        humanLogPath,
      });

      const text = fs.readFileSync(humanLogPath, 'utf8');
      assert.ok(text.includes('User Prompt'));
      assert.ok(text.includes('Log this run'));
      assert.ok(text.includes('Human log answer.'));
    } finally {
      modelClient.post = originalPost;
    }
  });

  it('tool loop: list_files → final', async () => {
    const originalPost = modelClient.post;
    let callCount = 0;
    modelClient.post = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'tu1', name: 'list_files', input: { path: '.' } },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: 'I found hello.js.' }],
      };
    };

    try {
      let logged = '';
      const originalLog = console.log;
      console.log = (msg) => {
        logged += msg;
      };

      await run({
        prompt: 'What files are here?',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        transcriptPath: path.join(tmpDir, 'loop.jsonl'),
      });

      console.log = originalLog;
      assert.equal(callCount, 2);
      assert.ok(logged.includes('hello.js'));
    } finally {
      modelClient.post = originalPost;
    }
  });

  it('stops at max_steps', async () => {
    const originalPost = modelClient.post;
    const originalExitCode = process.exitCode;
    const transcriptPath = path.join(tmpDir, 'max.jsonl');
    modelClient.post = async () => ({
      content: [{ type: 'tool_use', id: 'tu1', name: 'list_files', input: { path: '.' } }],
    });

    try {
      let logged = '';
      const originalLog = console.log;
      console.log = (msg) => {
        logged += msg;
      };

      await run({
        prompt: 'Loop forever',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 2,
        transcriptPath,
      });

      console.log = originalLog;
      assert.ok(logged.includes('max_steps'));
      assert.ok(fs.readFileSync(transcriptPath, 'utf8').includes('Reached max_steps'));
    } finally {
      modelClient.post = originalPost;
      process.exitCode = originalExitCode;
    }
  });
});

describe('agent loop — write/edit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-write-'));
  fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'original content\n');

  it('edit_file auto-approved with acceptEdits', async () => {
    const originalPost = modelClient.post;
    const savedExit = process.exitCode;

    let callCount = 0;
    modelClient.post = async () => {
      callCount++;
      if (callCount === 1) {
        // First call: request edit
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'edit_file',
              input: { path: 'file.txt', old_string: 'original', new_string: 'modified' },
            },
          ],
        };
      }
      // Second call: final answer
      return {
        content: [{ type: 'text', text: 'File has been modified successfully.' }],
      };
    };

    let logged = '';
    const originalLog = console.log;
    console.log = (msg) => {
      logged += msg;
    };

    try {
      await run({
        prompt: 'Edit file.txt',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        acceptEdits: true,
        transcriptPath: path.join(tmpDir, 'edit-auto.jsonl'),
      });

      // With acceptEdits, edit is auto-approved. Model returns final on step 2.
      assert.ok(logged.includes('modified'), 'should log modified text');
    } finally {
      console.log = originalLog;
      modelClient.post = originalPost;
      process.exitCode = savedExit;
    }
  });

  it('edit_file denied by user (mock confirm.ask → deny)', async () => {
    const originalPost = modelClient.post;
    const originalAsk = confirm.ask;
    const savedExit = process.exitCode;
    confirm.ask = async () => 'deny';

    let callCount = 0;
    modelClient.post = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'edit_file',
              input: { path: 'file.txt', old_string: 'original', new_string: 'modified' },
            },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: 'User denied the edit, so I will not proceed.' }],
      };
    };

    let logged = '';
    const originalLog = console.log;
    console.log = (msg) => {
      logged += msg;
    };

    try {
      await run({
        prompt: 'Edit file.txt',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        transcriptPath: path.join(tmpDir, 'edit-denied.jsonl'),
      });

      // Confirmation is denied, so tool_result says "User denied"
      assert.ok(logged.includes('User denied'), 'should log denied message');
    } finally {
      console.log = originalLog;
      modelClient.post = originalPost;
      confirm.ask = originalAsk;
      process.exitCode = savedExit;
    }
  });

  it('edit_file approved by user (mock confirm.ask → allow)', async () => {
    const originalPost = modelClient.post;
    const originalAsk = confirm.ask;
    const savedExit = process.exitCode;
    confirm.ask = async () => 'allow';

    let callCount = 0;
    modelClient.post = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'edit_file',
              input: { path: 'file.txt', old_string: 'original', new_string: 'modified' },
            },
          ],
        };
      }
      return {
        content: [{ type: 'text', text: 'Edit applied successfully.' }],
      };
    };

    let logged = '';
    const originalLog = console.log;
    console.log = (msg) => {
      logged += msg;
    };

    try {
      await run({
        prompt: 'Edit file.txt',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        transcriptPath: path.join(tmpDir, 'edit-approved.jsonl'),
      });

      assert.ok(logged.includes('Edit applied'), 'should log final answer');
    } finally {
      console.log = originalLog;
      modelClient.post = originalPost;
      confirm.ask = originalAsk;
      process.exitCode = savedExit;
    }
  });

  it('plan mode returns dry-run tool results without writing files', async () => {
    const originalPost = modelClient.post;
    const savedExit = process.exitCode;
    const plannedPath = path.join(tmpDir, 'planned.txt');
    let secondRequest;
    let callCount = 0;

    modelClient.post = async (body) => {
      callCount++;
      if (callCount === 1) {
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu-plan',
              name: 'write_file',
              input: { path: 'planned.txt', content: 'should not be written' },
            },
          ],
        };
      }
      secondRequest = JSON.parse(JSON.stringify(body));
      return {
        content: [{ type: 'text', text: 'Plan captured.' }],
      };
    };

    let logged = '';
    const originalLog = console.log;
    console.log = (msg) => {
      logged += msg;
    };

    try {
      await run({
        prompt: 'Plan a write',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 3,
        plan: true,
        acceptEdits: true,
        transcriptPath: path.join(tmpDir, 'plan-mode.jsonl'),
      });

      assert.equal(fs.existsSync(plannedPath), false);
      const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
      assert.equal(lastMessage.role, 'user');
      assert.ok(lastMessage.content[0].content.includes('Plan mode: would'));
      assert.ok(logged.includes('Plan captured'));
    } finally {
      console.log = originalLog;
      modelClient.post = originalPost;
      process.exitCode = savedExit;
    }
  });
});
