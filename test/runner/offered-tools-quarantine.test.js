'use strict';

// P0-05: exact offered-tool enforcement (P0-06 quarantine retired after repair).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { execute, getDefinitions, snapshotOfferedTools, QUARANTINED_TOOLS } = require('../../src/runner/tool-registry');

describe('offered-tool enforcement (P0-05)', () => {
  it('hard-denies a hidden tool that was never offered this turn', async () => {
    const ctx = { cwd: process.cwd(), allowShell: false, enableLsp: false, spawnDepth: 0 };
    snapshotOfferedTools(ctx, getDefinitions(ctx));
    assert.ok(!ctx.offeredTools.has('apply_patch'));

    const result = await execute('apply_patch', { path: 'x.js', patch_text: '@@' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /not offered this turn/i);
  });

  it('hard-denies an alias whose canonical tool was not offered', async () => {
    const ctx = { cwd: process.cwd(), allowShell: false, enableLsp: false, spawnDepth: 0 };
    snapshotOfferedTools(ctx, getDefinitions(ctx));

    const result = await execute('patch', { path: 'x.js', patch_text: '@@' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /not offered this turn/i);
  });

  it('allows a tool that appears in the exact offered snapshot', async () => {
    const ctx = {
      cwd: process.cwd(),
      allowShell: false,
      enableLsp: false,
      spawnDepth: 0,
      offeredTools: new Set(['list_files']),
    };
    const result = await execute('list_files', { path: '.' }, ctx);
    // May succeed or fail on path details; must not be "not offered".
    assert.ok(!/not offered this turn/i.test(result.text || ''));
  });

  it('QUARANTINED_TOOLS no longer includes apply_patch after P0-06 repair', () => {
    assert.ok(!QUARANTINED_TOOLS.has('apply_patch'));
    assert.equal(QUARANTINED_TOOLS.size, 0);
  });
});
