'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getDefinitions, execute, executeForce } = require('../../src/runner/tool-registry');

describe('tool-registry', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-tools-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'console.log("hello");\n');
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Hello\n');

  const ctx = { cwd: tmpDir };

  it('returns definitions for 8 tools (bash excluded by default)', () => {
    const defs = getDefinitions();
    assert.equal(defs.length, 8);
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('list_files'));
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('search_text'));
    assert.ok(names.includes('git_status'));
    assert.ok(names.includes('edit_file'));
    assert.ok(names.includes('write_file'));
    assert.ok(names.includes('apply_patch'));
    assert.ok(names.includes('undo'));
  });

  it('includes bash when allowShell is true', () => {
    const defs = getDefinitions({ allowShell: true });
    assert.equal(defs.length, 9);
    const names = defs.map((d) => d.name);
    assert.ok(names.includes('bash'));
  });

  it('list_files returns entries', () => {
    const result = execute('list_files', { path: '.' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('README.md'));
  });

  it('read_file returns file contents', () => {
    const result = execute('read_file', { path: 'src/app.js' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('hello'));
  });

  it('read_file denies secret file', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=1\n');
    const result = execute('read_file', { path: '.env' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('Permission denied'));
    fs.unlinkSync(path.join(tmpDir, '.env'));
  });

  it('search_text finds pattern', () => {
    const result = execute('search_text', { pattern: 'hello' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('hello'));
  });

  it('execute denies unknown tool', () => {
    const result = execute('some_fake_tool', {}, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('not in the allow-list'));
  });

  it('edit_file asks for confirmation (returns needsConfirmation)', () => {
    const result = execute('edit_file', { path: 'src/app.js', old_string: 'hello', new_string: 'hi' }, ctx);
    assert.equal(result.ok, false);
    assert.equal(result.needsConfirmation, true);
    assert.equal(result.toolName, 'edit_file');
  });

  it('edit_file auto-allows with acceptEdits', () => {
    const ctxApproved = { ...ctx, acceptEdits: true };
    const result = execute('edit_file', { path: 'src/app.js', old_string: 'hello', new_string: 'hi' }, ctxApproved);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('edited'));
  });

  it('write_file creates a new file with acceptEdits', () => {
    const ctxApproved = { ...ctx, acceptEdits: true };
    const result = execute('write_file', { path: 'new.js', content: '// hi' }, ctxApproved);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('created'));
    fs.unlinkSync(path.join(tmpDir, 'new.js'));
  });

  it('executeForce skips permission check', () => {
    const result = executeForce('write_file', { path: 'forced.js', content: '// forced' }, ctx);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('created'));
    fs.unlinkSync(path.join(tmpDir, 'forced.js'));
  });

  it('bash is denied when allowShell is false', () => {
    const result = execute('bash', { command: 'echo hi' }, ctx);
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('--allow-shell'));
  });

  it('bash works with allowShell and dontAsk', () => {
    const ctxShell = { ...ctx, allowShell: true, dontAsk: true };
    const result = execute('bash', { command: 'echo hello' }, ctxShell);
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('hello'));
  });
});
