'use strict';

const { it } = require('node:test');
const { execFileSync } = require('node:child_process');

it('selects the current macOS account when duplicate Claude Keychain services exist', () => {
  // Run the real discovery module in an isolated child. All Keychain and file
  // access is mocked, so this test cannot read a person's actual credentials.
  const script = `
    const assert = require('node:assert/strict');
    const cp = require('node:child_process');
    const os = require('node:os');
    const fs = require('node:fs');
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    os.userInfo = () => ({ username: 'test user with spaces' });
    const reads = [];
    cp.execFileSync = (file, args) => {
      reads.push({ file, args });
      // This recreates the live failure: an unscoped read finds an entry
      // containing only MCP data; the account-scoped read finds Claude OAuth.
      return JSON.stringify(args.includes('-a')
        ? { claudeAiOauth: { accessToken: 'synthetic-oauth-token' } }
        : { mcpOAuth: {} });
    };
    cp.execSync = () => { throw new Error('Shell-based credential lookup is forbidden'); };
    fs.existsSync = () => false;
    const { getCredentials } = require('./src/credentials');
    const credentials = getCredentials({ CREDS_CACHE_TTL: 0 });
    assert.equal(credentials.source, 'keychain');
    assert.equal(credentials.accessToken, 'synthetic-oauth-token');
    assert.deepEqual(reads, [{ file: 'security', args: [
      'find-generic-password', '-s', 'Claude Code-credentials',
      '-a', 'test user with spaces', '-w'
    ] }]);
  `;
  execFileSync(process.execPath, ['--require', './test/setup.js', '-e', script], {
    cwd: require('node:path').resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
  });
});
