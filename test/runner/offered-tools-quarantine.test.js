'use strict';

// P0-05 / P0-06: exact offered-tool enforcement and apply_patch quarantine.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  execute,
  executeForce,
  getDefinitions,
  snapshotOfferedTools,
  QUARANTINED_TOOLS,
} = require('../../src/runner/tool-registry');
const { isToolVisible, computeAllowedTools } = require('../../src/runner/tool-visibility');
const applyPatch = require('../../src/runner/tools/apply-patch');

describe('offered-tool enforcement (P0-05)', () => {
  it('hard-denies a hidden tool that was never offered this turn', async () => {
    const ctx = { cwd: process.cwd(), allowShell: false, enableLsp: false, spawnDepth: 0 };
    snapshotOfferedTools(ctx, getDefinitions(ctx));
    assert.ok(!ctx.offeredTools.has('apply_patch'));

    const result = await execute('apply_patch', { path: 'x.js', patch_text: '@@' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /not offered this turn|quarantined/i);
  });

  it('hard-denies an alias whose canonical tool was not offered', async () => {
    const ctx = { cwd: process.cwd(), allowShell: false, enableLsp: false, spawnDepth: 0 };
    snapshotOfferedTools(ctx, getDefinitions(ctx));

    const result = await execute('patch', { path: 'x.js', patch_text: '@@' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /not offered this turn|quarantined/i);
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
});

describe('apply_patch quarantine (P0-06)', () => {
  it('marks apply_patch as quarantined in the catalog', () => {
    assert.ok(QUARANTINED_TOOLS.has('apply_patch'));
  });

  it('never offers apply_patch even when named in --tools', () => {
    const ctx = {
      allowShell: true,
      enableLsp: false,
      spawnDepth: 0,
      _cliToolAllowlist: new Set(['read_file', 'apply_patch']),
    };
    const allowed = computeAllowedTools(ctx);
    assert.ok(!allowed.has('apply_patch'));
    assert.equal(isToolVisible('apply_patch', { ...ctx, allowedTools: allowed }), false);
  });

  it('execute always refuses with a quarantine message', () => {
    const result = applyPatch.execute(
      { path: 'x.js', patch_text: '@@ -1 +1 @@\n-a\n+b\n' },
      {
        cwd: process.cwd(),
      },
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /quarantined/i);
  });

  it('executeForce also refuses a quarantined tool', async () => {
    const ctx = {
      cwd: process.cwd(),
      acceptEdits: true,
      dontAsk: true,
      offeredTools: new Set(['apply_patch']),
    };
    const result = await executeForce('apply_patch', { path: 'x.js', patch_text: '@@' }, ctx);
    assert.equal(result.ok, false);
    assert.match(result.text, /not offered this turn|quarantined/i);
  });
});
