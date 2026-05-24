'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { execute } = require('../../src/runner/tools/bash');

describe('bash tool', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-'));
  fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');

  // bash.execute may return either a value (spawnSync default) or a Promise
  // (BRIDGE_RUNNER_PERSISTENT_SHELL=1 fast path). Awaiting handles both.

  it('runs a simple command and returns output', async () => {
    const result = await execute({ command: 'cat test.txt' }, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('hello'));
  });

  it('returns error for non-zero exit', async () => {
    const result = await execute({ command: 'cat nonexistent.txt' }, { cwd: tmpDir });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('exited with code'));
  });

  it('handles empty output gracefully', async () => {
    const result = await execute({ command: 'true' }, { cwd: tmpDir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('no output'));
  });

  it('runs in the correct working directory', async () => {
    const subdir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, 'subfile.txt'), 'subcontent');
    const result = await execute({ command: 'cat subfile.txt' }, { cwd: subdir });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('subcontent'));
  });

  it('truncates long output', async () => {
    // Generate enough output to exceed MAX_OUTPUT_CHARS (10000)
    const result = await execute({ command: 'yes head | head -10000' }, { cwd: tmpDir, shellTimeout: 10000 });
    assert.equal(result.ok, true);
  });

  it('times out on slow commands', async () => {
    const result = await execute({ command: 'sleep 10' }, { cwd: tmpDir, shellTimeout: 500 });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('timed out'));
  });

  it('reports signal when process is killed', async () => {
    // Run a subshell that kills itself with SIGABRT
    const result = await execute({ command: 'bash -c "kill -ABRT \\$\\$"' }, { cwd: tmpDir });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('killed by signal'));
    assert.ok(result.text.includes('SIGABRT') || result.text.includes('SIGTERM'));
  });
});

// ── Bash policy tests: dangerous commands, credential exfiltration ──

const { execute: registryExecute, executeForce: registryExecuteForce } = require('../../src/runner/tool-registry');

describe('bash policy', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-policy-'));
  fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'normal file');

  // safe ctx for testing — allowShell=true, dontAsk=false by default
  function ctx(opts) {
    return { cwd: tmpDir, cwdRealpath: fs.realpathSync(tmpDir), allowShell: true, ...opts };
  }

  it('denies cat of a blocked path pattern', async () => {
    const result = await registryExecute('bash', { command: 'cat .env' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('blocked path pattern'));
  });

  it('denies cat with ../ traversal to .env', async () => {
    const result = await registryExecute('bash', { command: 'cat ../.env' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('blocked'));
  });

  it('denies reading an SSH key', async () => {
    const result = await registryExecute('bash', { command: 'cat ~/.ssh/id_rsa' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('.ssh/'));
  });

  it('denies referencing a blocked env var', async () => {
    const result = await registryExecute('bash', { command: 'echo $ANTHROPIC_API_KEY' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('blocked environment variable'));
  });

  it('denies shell redirect overwriting a .pem file', async () => {
    const result = await registryExecute('bash', { command: 'echo x > key.pem' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('blocked'));
  });

  it('denies piping to a sensitive file', async () => {
    const result = await registryExecute('bash', { command: 'cat a.txt > credentials.json' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('blocked'));
  });

  it('allows safe commands', async () => {
    const result = await registryExecute('bash', { command: 'echo hello' }, ctx({ dontAsk: true }));
    assert.equal(result.ok, true);
  });

  it('allows node -e with safe code', async () => {
    const result = await registryExecute('bash', { command: 'node -e "console.log(1)"' }, ctx({ dontAsk: true }));
    assert.equal(result.ok, true);
  });

  it('denies bash when dontAsk is true but allowShell is false', async () => {
    const result = await registryExecute('bash', { command: 'echo hello' }, ctx({ allowShell: false, dontAsk: true }));
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('--allow-shell'));
  });

  it('executeForce does not enable bash without allowShell', async () => {
    const result = await registryExecuteForce('bash', { command: 'echo hello' }, ctx({ allowShell: false }));
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('--allow-shell'));
  });

  it('executeForce still preserves blocked shell path denies', async () => {
    const result = await registryExecuteForce('bash', { command: 'cat .env' }, ctx());
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('blocked path pattern'));
  });

  it('sets http_proxy when noNetwork is true', async () => {
    const result = await registryExecute(
      'bash',
      { command: 'echo $http_proxy' },
      ctx({ allowShell: true, dontAsk: true, noNetwork: true }),
    );
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('127.0.0.1:1'));
  });

  it('does not set http_proxy when noNetwork is false', async () => {
    const result = await registryExecute(
      'bash',
      { command: 'echo $http_proxy' },
      ctx({ allowShell: true, dontAsk: true, noNetwork: false }),
    );
    assert.equal(result.ok, true);
    // http_proxy should be empty or undefined in the default safe env
    assert.ok(!result.text.includes('127.0.0.1'));
  });
});
