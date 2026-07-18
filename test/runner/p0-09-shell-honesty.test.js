'use strict';

/**
 * P0-09 — shell sandbox honesty.
 * Every shell-enabling surface must state local-account authority and
 * must not claim cwd confinement or hard network isolation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bash = require('../../src/runner/tools/bash');
const manageShellJobs = require('../../src/runner/tools/manage-shell-jobs');
const permissions = require('../../src/runner/permissions');
const { SHELL_AUTHORITY_HONESTY, SHELL_AUTHORITY_SHORT } = require('../../src/runner/shell-policy');
const contextBuilder = require('../../src/runner/context-builder');

const ROOT = path.resolve(__dirname, '../..');

describe('P0-09 shell sandbox honesty', () => {
  it('exports shared honesty constants', () => {
    assert.match(SHELL_AUTHORITY_HONESTY, /unsandboxed local-account authority/i);
    assert.match(SHELL_AUTHORITY_HONESTY, /not OS isolation/i);
    assert.match(SHELL_AUTHORITY_SHORT, /not cwd confinement/i);
    assert.match(SHELL_AUTHORITY_SHORT, /best-effort/i);
  });

  it('bash and manage_shell_jobs definitions carry honesty language', () => {
    const bashDef = bash.definition();
    assert.match(bashDef.description, /unsandboxed local-account authority/i);
    assert.doesNotMatch(bashDef.description, /\bsandboxed\b/i);
    assert.match(bashDef.input_schema.properties.command.description, /not confined/i);

    const jobsDef = manageShellJobs.definition();
    assert.match(jobsDef.description, /unsandboxed local-account authority/i);
    assert.match(jobsDef.input_schema.properties.command.description, /not confined/i);
  });

  it('shell confirmation proposedAction includes honesty line', () => {
    const result = permissions.check('bash', { command: 'ls' }, { allowShell: true, cwd: ROOT });
    assert.equal(result.decision, 'ask');
    assert.match(result.proposedAction, /unsandboxed local-account authority/i);
    assert.match(result.proposedAction, /not cwd confinement/i);
    assert.match(result.explanation, /not cwd confinement/i);
  });

  it('system prompt rules distinguish file-tool confinement from shell', () => {
    const withShell = contextBuilder.buildSystem({ allowShell: true, cwd: ROOT }, { progressive: false });
    assert.match(withShell, /File tools may only access paths inside the working directory/);
    assert.match(withShell, /unsandboxed local-account authority/i);
    assert.match(withShell, /NOT confined/i);

    const noShell = contextBuilder.buildSystem({ allowShell: false, cwd: ROOT }, { progressive: false });
    assert.doesNotMatch(noShell, /unsandboxed local-account authority/i);
  });

  it('CLI help and key docs do not claim cwd jail or hard network sandbox', () => {
    const help = fs.readFileSync(path.join(ROOT, 'bin/local-bridge-runner.js'), 'utf8');
    assert.match(help, /unsandboxed local-account authority/);
    assert.match(help, /not hard network isolation/);

    const threat = fs.readFileSync(path.join(ROOT, 'docs/threat-model.md'), 'utf8');
    assert.match(threat, /not.*cwd-confined/i);
    assert.match(threat, /not.*hard network isolation/i);
    assert.doesNotMatch(threat, /Run shell commands inside `cwd`\./);

    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /unsandboxed local-account authority/);

    const builder = fs.readFileSync(path.join(ROOT, 'docs/command-builder.html'), 'utf8');
    assert.match(builder, /unsandboxed local-account authority/);
    assert.match(builder, /not.*confined to it/i);

    const quickstart = fs.readFileSync(path.join(ROOT, 'docs/runner-quickstart.html'), 'utf8');
    assert.match(quickstart, /unsandboxed local-account authority/);
    assert.match(quickstart, /not hard network isolation/);
  });
});
