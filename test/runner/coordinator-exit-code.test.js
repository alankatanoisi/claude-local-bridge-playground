'use strict';

/**
 * A3-F1 — coordinator CLI exit code for research-only runs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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
