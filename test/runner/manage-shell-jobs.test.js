'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');

const manageShellJobs = require('../../src/runner/tools/manage-shell-jobs');
const { getDefinitions } = require('../../src/runner/tool-registry');

describe('manage_shell_jobs', () => {
  it('is hidden unless allowShell is set', () => {
    const hidden = getDefinitions({ cwd: '/tmp', allowShell: false }).map((d) => d.name);
    const visible = getDefinitions({ cwd: '/tmp', allowShell: true }).map((d) => d.name);
    assert.ok(!hidden.includes('manage_shell_jobs'));
    assert.ok(visible.includes('manage_shell_jobs'));
  });

  it('starts, lists, polls, and kills a background job', async () => {
    const ctx = { cwd: os.tmpdir(), cwdRealpath: os.tmpdir(), allowShell: true };
    const started = await manageShellJobs.execute({ action: 'start', command: 'echo bg_ok' }, ctx);
    assert.equal(started.ok, true);
    assert.ok(started.text.includes('shjob_'));

    const listed = await manageShellJobs.execute({ action: 'list' }, ctx);
    assert.match(listed.text, /bg_ok/);

    const jobId = started.text.match(/shjob_[a-f0-9]+/)[0];
    await new Promise((resolve) => setTimeout(resolve, 200));

    const polled = await manageShellJobs.execute({ action: 'poll', job_id: jobId }, ctx);
    assert.match(polled.text, /completed|failed|running/);

    const killed = await manageShellJobs.execute({ action: 'kill', job_id: jobId }, ctx);
    assert.equal(killed.ok, true);
  });

  it('blocks dangerous commands via shell policy', async () => {
    const ctx = { cwd: os.tmpdir(), cwdRealpath: os.tmpdir(), allowShell: true };
    const started = await manageShellJobs.execute({ action: 'start', command: 'cat ~/.ssh/id_rsa' }, ctx);
    assert.equal(started.ok, false);
    assert.match(started.text, /blocked/i);
  });
});
