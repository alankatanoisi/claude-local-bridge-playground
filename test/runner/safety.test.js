'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const safety = require('../../src/runner/safety');

describe('runner safety helpers', () => {
  it('scrubs Anthropic keys', () => {
    const text = safety.scrubSecrets('key=sk-ant-' + 'a'.repeat(30));
    assert.ok(text.includes('[REDACTED:anthropic_key]'));
  });

  it('scrubs private key blocks', () => {
    const text = safety.scrubSecrets('-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----');
    assert.equal(text, '[REDACTED:private_key_block]');
  });

  it('scrubs GitHub and AWS-looking tokens', () => {
    const text = safety.scrubSecrets('ghp_' + 'a'.repeat(36) + ' AKIA' + 'A'.repeat(16));
    assert.ok(text.includes('[REDACTED:github_token]'));
    assert.ok(text.includes('[REDACTED:aws_access_key]'));
  });

  it('scrubs bearer tokens', () => {
    const text = safety.scrubSecrets('Authorization: Bearer ' + 'abc123'.repeat(6));
    assert.ok(text.includes('Bearer [REDACTED]'));
  });

  it('leaves normal text unchanged', () => {
    assert.equal(safety.scrubSecrets('hello world'), 'hello world');
  });

  it('buildSafeEnv strips credential variables', () => {
    const oldAws = process.env.AWS_ACCESS_KEY_ID;
    const oldAnthropic = process.env.ANTHROPIC_API_KEY;
    process.env.AWS_ACCESS_KEY_ID = 'AKIA' + 'A'.repeat(16);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(30);
    try {
      const env = safety.buildSafeEnv();
      assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
      assert.equal(env.ANTHROPIC_API_KEY, undefined);
    } finally {
      if (oldAws === undefined) delete process.env.AWS_ACCESS_KEY_ID;
      else process.env.AWS_ACCESS_KEY_ID = oldAws;
      if (oldAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = oldAnthropic;
    }
  });

  it('validateCwd rejects system and non-existent directories', () => {
    assert.equal(safety.validateCwd('/').valid, false);
    assert.equal(safety.validateCwd('/definitely/not/a/real/project').valid, false);
  });

  it('validateCwd accepts a project directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-cwd-'));
    assert.equal(safety.validateCwd(tmpDir).valid, true);
  });

  it('confinePath catches path traversal outside cwd', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-path-'));
    const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };
    assert.equal(safety.confinePath(ctx, '../outside.txt'), null);
  });

  it('confinePath catches symlink escapes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-link-'));
    const project = path.join(root, 'project');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(project, 'linked-outside'));

    const ctx = { cwd: project, cwdRealpath: fs.realpathSync(project) };
    assert.equal(safety.confinePath(ctx, 'linked-outside/secret.txt'), null);
  });

  it('confinePath allows fake cwd fixtures with lexical containment', () => {
    const ctx = { cwd: '/fake/project' };
    assert.equal(safety.confinePath(ctx, 'src/app.js'), '/fake/project/src/app.js');
  });

  it('deny matrix blocks sensitive paths and allows normal paths', () => {
    assert.equal(safety.isPathBlockedByDenyMatrix('/tmp/project/.env'), true);
    assert.equal(safety.isPathBlockedByDenyMatrix('/tmp/project/.ssh/id_rsa'), true);
    assert.equal(safety.isPathBlockedByDenyMatrix('/tmp/project/key.pem'), true);
    assert.equal(safety.isPathBlockedByDenyMatrix('/tmp/project/src/app.js'), false);
  });
});

// ── Integration: secret redaction through the full pipeline ──

const { execute, executeForce } = require('../../src/runner/tool-registry');

describe('runner secret redaction integration', () => {
  const ANTHROPIC_KEY = 'sk-ant-abc123def456ghi789jkl012mno345pqr678stu';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'));

  it('tool-registry.execute scrubs secrets from read_file results', () => {
    const filePath = path.join(tmpDir, 'leaky-config.js');
    fs.writeFileSync(filePath, 'const key = "' + ANTHROPIC_KEY + '";\nconst normal = "hello";\n');

    const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };
    const result = execute('read_file', { path: 'leaky-config.js' }, ctx, 'tu-test');

    assert.equal(result.ok, true);
    assert.ok(result.text.includes('normal'));
    assert.ok(result.text.includes('[REDACTED:anthropic_key]'));
    assert.ok(!result.text.includes(ANTHROPIC_KEY));
  });

  it('tool-registry.executeForce still scrubs secrets', () => {
    const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };
    const result = executeForce('read_file', { path: 'leaky-config.js' }, ctx, 'tu-test');

    assert.equal(result.ok, true);
    assert.ok(result.text.includes('[REDACTED:anthropic_key]'));
    assert.ok(!result.text.includes(ANTHROPIC_KEY));
  });

  it('scrubs secrets from bash tool stdout', () => {
    const ctx = {
      cwd: tmpDir,
      cwdRealpath: fs.realpathSync(tmpDir),
      allowShell: true,
      dontAsk: true,
    };
    const result = execute('bash', { command: 'cat leaky-config.js' }, ctx);

    assert.equal(result.ok, true);
    assert.ok(result.text.includes('normal'));
    assert.ok(result.text.includes('[REDACTED:anthropic_key]'));
    assert.ok(!result.text.includes(ANTHROPIC_KEY));
  });

  it('scrubs secrets from search_text results', () => {
    const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };
    const result = execute('search_text', { pattern: ANTHROPIC_KEY.slice(0, 10) }, ctx);

    assert.equal(result.ok, true);
    assert.ok(!result.text.includes(ANTHROPIC_KEY));
  });

  it('secret basename is denied even before tool execution', () => {
    const ctx = { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir) };
    const result = execute('read_file', { path: '.env' }, ctx);

    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Permission denied'));
  });
});

// ── Integration: agent loop does not leak secrets ──

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

describe('runner agent loop redaction', () => {
  const ANTHROPIC_KEY = 'sk-ant-xyzneverleak78901234567890123456789012';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-redact-'));
  fs.writeFileSync(path.join(tmpDir, 'config.json'), '{"key":"' + ANTHROPIC_KEY + '"}');

  it('transcript never contains unscrubbed keys', async () => {
    const savedExit = process.exitCode;
    const originalPost = modelClient.post;
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    modelClient.post = async () => ({
      content: [
        { type: 'text', text: 'Reading...' },
        { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'config.json' } },
      ],
    });

    try {
      await run({
        prompt: 'read config',
        cwd: tmpDir,
        model: 'test',
        maxTokens: 10,
        maxSteps: 2,
        transcriptPath,
        acceptEdits: true,
      });

      const transcriptText = fs.readFileSync(transcriptPath, 'utf8');
      assert.ok(transcriptText.length > 0);
      assert.ok(transcriptText.includes('[REDACTED:anthropic_key]'));
      assert.ok(!transcriptText.includes(ANTHROPIC_KEY));
    } finally {
      modelClient.post = originalPost;
      process.exitCode = savedExit;
    }
  });

  it('stream-json output never contains unscrubbed keys', async () => {
    const savedExit = process.exitCode;
    const originalPost = modelClient.post;
    modelClient.post = async () => ({
      content: [{ type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'config.json' } }],
    });

    try {
      const stdout = await captureStdout(() =>
        run({
          prompt: 'read config',
          cwd: tmpDir,
          model: 'test',
          maxTokens: 10,
          maxSteps: 2,
          outputFormat: 'stream-json',
          acceptEdits: true,
        }),
      );

      assert.ok(stdout.includes('[REDACTED:anthropic_key]'));
      assert.ok(!stdout.includes(ANTHROPIC_KEY));

      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) JSON.parse(line);
    } finally {
      modelClient.post = originalPost;
      process.exitCode = savedExit;
    }
  });

  it('JSON output never contains unscrubbed keys', async () => {
    const savedExit = process.exitCode;
    const originalPost = modelClient.post;
    modelClient.post = async () => ({
      content: [{ type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'config.json' } }],
    });

    try {
      const stdout = await captureStdout(() =>
        run({
          prompt: 'read config',
          cwd: tmpDir,
          model: 'test',
          maxTokens: 10,
          maxSteps: 2,
          outputFormat: 'json',
          acceptEdits: true,
        }),
      );

      assert.ok(stdout.includes('[REDACTED:anthropic_key]'));
      assert.ok(!stdout.includes(ANTHROPIC_KEY));
      JSON.parse(stdout.trim());
    } finally {
      modelClient.post = originalPost;
      process.exitCode = savedExit;
    }
  });
});
