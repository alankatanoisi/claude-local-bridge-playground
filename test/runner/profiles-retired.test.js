'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { run } = require('../../src/runner/run');
const { computeAllowedTools, isToolVisible } = require('../../src/runner/tool-visibility');
const spawnAgent = require('../../src/runner/tools/spawn-agent');

const runnerBin = path.resolve(__dirname, '../../bin/local-bridge-runner.js');

describe('retired runner profiles', () => {
  it('removes agent and capability profiles from CLI help', () => {
    const result = spawnSync(process.execPath, [runnerBin, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /--agent\b|--profile\b|--list-agents\b|--list-profiles\b/);
  });

  it('rejects legacy profile flags instead of silently applying or ignoring them', () => {
    for (const flag of ['--agent', '--profile', '--list-agents', '--list-profiles']) {
      const args = flag.startsWith('--list-') ? [runnerBin, flag] : [runnerBin, flag, 'legacy', 'hello'];
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
      assert.notEqual(result.status, 0, flag + ' must not remain callable');
      assert.match(result.stderr, /unknown option/i);
    }
  });

  it('rejects legacy programmatic profile options before runtime setup', async () => {
    await assert.rejects(() => run({ agentProfile: 'implement' }), /profiles are retired.*explicit flags/i);
    await assert.rejects(() => run({ toolProfileName: 'review-only' }), /profiles are retired.*explicit flags/i);
  });

  it('derives visibility only from feature gates and the explicit tool allowlist', () => {
    const ctx = {
      allowShell: false,
      enableLsp: false,
      spawnDepth: 0,
      _cliToolAllowlist: new Set(['read_file', 'bash', 'apply_patch']),
    };
    const allowed = computeAllowedTools(ctx);
    assert.deepEqual([...allowed].sort(), ['apply_patch', 'read_file']);
    assert.equal(isToolVisible('read_file', { ...ctx, allowedTools: allowed }), true);
    assert.equal(isToolVisible('bash', { ...ctx, allowedTools: allowed }), false);
  });

  it('keeps subagents generic and read-only without a profile selector', () => {
    const definition = spawnAgent.definition();
    assert.equal(definition.input_schema.properties.agent, undefined);
    assert.deepEqual(definition.input_schema.required, ['prompt']);
    assert.match(definition.description, /read-only.*generic/i);
  });
});
