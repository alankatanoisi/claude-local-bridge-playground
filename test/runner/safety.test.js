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
