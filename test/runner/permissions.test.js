'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { check, isInsideProject, isBlockedBasename } = require('../../src/runner/permissions');

describe('permissions — read-only tools', () => {
  const cwd = '/fake/project';

  it('allows read_file for a normal project file', () => {
    const result = check('read_file', { path: 'src/server.js' }, { cwd });
    assert.equal(result.decision, 'allow');
  });

  it('denies read_file for ../outside.txt', () => {
    const result = check('read_file', { path: '../outside.txt' }, { cwd });
    assert.equal(result.decision, 'deny');
    assert.ok(result.reason.includes('escapes'));
  });

  it('denies read_file for .env', () => {
    const result = check('read_file', { path: '.env' }, { cwd });
    assert.equal(result.decision, 'deny');
    assert.ok(result.reason.includes('Blocked'));
  });

  it('denies read_file for credentials.json', () => {
    const result = check('read_file', { path: 'config/credentials.json' }, { cwd });
    assert.equal(result.decision, 'deny');
  });

  it('denies read_file for *.pem', () => {
    const result = check('read_file', { path: 'keys/id_rsa.pem' }, { cwd });
    assert.equal(result.decision, 'deny');
  });

  it('allows list_files at root', () => {
    const result = check('list_files', { path: '.' }, { cwd });
    assert.equal(result.decision, 'allow');
  });

  it('allows git_status', () => {
    const result = check('git_status', {}, { cwd });
    assert.equal(result.decision, 'allow');
  });

  it('denies absolute path', () => {
    const result = check('read_file', { path: '/etc/passwd' }, { cwd });
    assert.equal(result.decision, 'deny');
  });
});

describe('permissions — write tools', () => {
  const cwd = '/fake/project';

  it('edit_file asks for confirmation by default', () => {
    const result = check('edit_file', { path: 'src/app.js', old_string: 'a', new_string: 'b' }, { cwd });
    assert.equal(result.decision, 'ask');
    assert.ok(result.proposedAction.includes('Edit'));
  });

  it('edit_file allows with acceptEdits', () => {
    const result = check('edit_file', { path: 'src/app.js' }, { cwd, acceptEdits: true });
    assert.equal(result.decision, 'allow');
  });

  it('write_file asks when not overwriting', () => {
    const result = check('write_file', { path: 'new-file.js' }, { cwd });
    assert.equal(result.decision, 'ask');
  });

  it('apply_patch asks for confirmation', () => {
    const result = check('apply_patch', { path: 'src/app.js' }, { cwd });
    assert.equal(result.decision, 'ask');
  });

  it('write tools still deny path escapes', () => {
    const result = check('edit_file', { path: '../../outside.txt' }, { cwd });
    assert.equal(result.decision, 'deny');
  });

  it('write tools still deny .env even with acceptEdits', () => {
    const result = check('edit_file', { path: '.env' }, { cwd, acceptEdits: true });
    assert.equal(result.decision, 'deny');
  });
});

describe('permissions — shell tool', () => {
  const cwd = '/fake/project';

  it('bash is denied when allowShell is false', () => {
    const result = check('bash', { command: 'ls' }, { cwd });
    assert.equal(result.decision, 'deny');
    assert.ok(result.reason.includes('--allow-shell'));
  });

  it('bash asks when allowShell is true but dontAsk is false', () => {
    const result = check('bash', { command: 'ls' }, { cwd, allowShell: true });
    assert.equal(result.decision, 'ask');
  });

  it('bash allows when allowShell and dontAsk are true', () => {
    const result = check('bash', { command: 'ls' }, { cwd, allowShell: true, dontAsk: true });
    assert.equal(result.decision, 'allow');
  });
});

describe('permissions — unknown tools', () => {
  const cwd = '/fake/project';

  it('denies a truly unknown tool', () => {
    const result = check('rm_rf', {}, { cwd });
    assert.equal(result.decision, 'deny');
    assert.ok(result.reason.includes('not in the allow-list'));
  });
});

describe('isInsideProject', () => {
  it('returns true for a normal relative path', () => {
    assert.equal(isInsideProject('src/app.js', '/home/proj'), true);
  });

  it('returns false for ../escape', () => {
    assert.equal(isInsideProject('../secret.txt', '/home/proj'), false);
  });

  it('returns false for absolute path', () => {
    assert.equal(isInsideProject('/etc/passwd', '/home/proj'), false);
  });
});

describe('isBlockedBasename', () => {
  it('blocks .env', () => {
    assert.equal(isBlockedBasename('.env'), true);
  });

  it('blocks credentials.json', () => {
    assert.equal(isBlockedBasename('credentials.json'), true);
  });

  it('allows README.md', () => {
    assert.equal(isBlockedBasename('README.md'), false);
  });
});
