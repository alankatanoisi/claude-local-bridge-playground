'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compileSpec, isVagueDigest } = require('../../src/runner/coordinator-spec-compiler');

describe('coordinator spec compiler', () => {
  it('rejects vague digests', () => {
    const r = compileSpec('fix bug', [{ summary: 'based on your findings' }]);
    assert.equal(r.rejected, true);
  });

  it('populates synthesisNotes and rejects pass-through', () => {
    const digest =
      'Found src/runner/run.js orchestrates the agent loop with tool batching and session persistence hooks.';
    const r = compileSpec('Improve runner safety', [
      {
        summary: digest,
        claims: [digest],
        evidencePaths: ['src/runner/run.js'],
        confidence: 'high',
      },
    ]);
    assert.equal(r.rejected, false);
    assert.ok(r.structured.synthesisNotes);
    assert.ok(r.spec.includes('Implementation spec'));
    assert.ok(r.spec.includes('run.js'));
  });

  it('isVagueDigest flags short digests', () => {
    assert.equal(isVagueDigest('too short'), true);
    assert.equal(isVagueDigest('x'.repeat(80)), false);
  });
});
