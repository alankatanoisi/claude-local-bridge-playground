'use strict';

/**
 * A3-F1 — coordinator CLI exit code for research-only runs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { exitCodeForCoordinatorResult } = require('../../bin/local-bridge-coordinator');

describe('coordinator exit code (A3-F1)', () => {
  it('research-only success exits 0 even when kernelResult is null', () => {
    assert.equal(
      exitCodeForCoordinatorResult({
        phases: ['research', 'synthesize'],
        error: null,
        kernelResult: null,
      }),
      0,
    );
  });

  it('result.error exits 1', () => {
    assert.equal(
      exitCodeForCoordinatorResult({
        phases: ['research'],
        error: 'Spec compilation rejected: empty_or_vague_research_digest',
        kernelResult: null,
      }),
      1,
    );
  });

  it('execute success exits 0', () => {
    assert.equal(
      exitCodeForCoordinatorResult({
        phases: ['research', 'synthesize', 'execute'],
        error: null,
        kernelResult: { stopReason: 'success' },
      }),
      0,
    );
  });

  it('execute failure exits 1', () => {
    assert.equal(
      exitCodeForCoordinatorResult({
        phases: ['execute'],
        error: null,
        kernelResult: { stopReason: 'model_max_tokens' },
      }),
      1,
    );
  });

  it('execute phase without kernelResult exits 1', () => {
    assert.equal(
      exitCodeForCoordinatorResult({
        phases: ['execute'],
        error: null,
        kernelResult: null,
      }),
      1,
    );
  });
});

describe('coordinator CLI preflight', () => {
  const bin = path.join(__dirname, '..', '..', 'bin', 'local-bridge-coordinator.js');

  function runInvalid(...args) {
    return spawnSync(process.execPath, [bin, ...args, 'test objective'], {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8',
    });
  }

  it('rejects verify without execute before workspace trust or model work', () => {
    const result = runInvalid('--phases', 'research,verify');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verify phase requires execute/);
    assert.doesNotMatch(result.stderr, /workspace_not_trusted/);
  });

  it('rejects execute-only authority flags when execute is absent', () => {
    const result = runInvalid('--phases', 'research', '--accept-edits');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /execute-only option.*--accept-edits/);
  });

  it('rejects inactive fan-out plans and invalid numeric controls', () => {
    const inactivePlan = runInvalid('--phases', 'execute', '--research-plan', 'missing.json');
    assert.equal(inactivePlan.status, 1);
    assert.match(inactivePlan.stderr, /research-plan requires the research phase/);

    const badTemperature = runInvalid('--temperature', 'not-a-number');
    assert.equal(badTemperature.status, 1);
    assert.match(badTemperature.stderr, /temperature must be a number between 0 and 1/);

    const zeroCost = runInvalid('--max-cost-usd', '0');
    assert.equal(zeroCost.status, 1);
    assert.match(zeroCost.stderr, /must be greater than zero/);
  });
});
