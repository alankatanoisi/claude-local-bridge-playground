'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { groupPhasePlanByDeps, runPhasePlan } = require('../../src/runner/coordinator');
const { compileSpec } = require('../../src/runner/coordinator-spec-compiler');

describe('D1 phasePlan executor', () => {
  it('groups dep-free phases into one batch', () => {
    const plan = [
      { id: 'a', deps: [] },
      { id: 'b', deps: [] },
      { id: 'c', deps: [] },
    ];
    const batches = groupPhasePlanByDeps(plan);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].sort(), ['a', 'b', 'c']);
  });

  it('orders batches by dependency depth', () => {
    const plan = [
      { id: 'apply', deps: ['inspect'] },
      { id: 'inspect', deps: [] },
      { id: 'verify', deps: ['apply'] },
    ];
    const batches = groupPhasePlanByDeps(plan);
    assert.deepEqual(batches, [['inspect'], ['apply'], ['verify']]);
  });

  it('groups parallel branches that share a single dep root', () => {
    const plan = [
      { id: 'root', deps: [] },
      { id: 'l1', deps: ['root'] },
      { id: 'l2', deps: ['root'] },
      { id: 'l3', deps: ['root'] },
      { id: 'leaf', deps: ['l1', 'l2', 'l3'] },
    ];
    const batches = groupPhasePlanByDeps(plan);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches[0], ['root']);
    assert.deepEqual(batches[1].sort(), ['l1', 'l2', 'l3']);
    assert.deepEqual(batches[2], ['leaf']);
  });

  it('throws on cycle', () => {
    const plan = [
      { id: 'a', deps: ['b'] },
      { id: 'b', deps: ['a'] },
    ];
    assert.throws(() => groupPhasePlanByDeps(plan), /cycle/i);
  });

  it('throws on missing dep', () => {
    const plan = [{ id: 'a', deps: ['ghost'] }];
    assert.throws(() => groupPhasePlanByDeps(plan), /missing dep/);
  });

  it('runPhasePlan runs each batch in parallel and returns results map', async () => {
    const observed = [];
    const plan = [
      { id: 'a', deps: [] },
      { id: 'b', deps: [] },
      { id: 'c', deps: ['a', 'b'] },
    ];
    const runFn = async (id) => {
      observed.push('start:' + id);
      await new Promise((r) => setTimeout(r, 10));
      observed.push('done:' + id);
      return 'r:' + id;
    };
    const results = await runPhasePlan(plan, runFn);
    assert.equal(results.get('a'), 'r:a');
    assert.equal(results.get('b'), 'r:b');
    assert.equal(results.get('c'), 'r:c');
    // a and b start before either completes (parallel)
    const aDone = observed.indexOf('done:a');
    const bStart = observed.indexOf('start:b');
    assert.ok(bStart < aDone, 'b started before a finished');
    assert.ok(observed.indexOf('start:c') > aDone, 'c started after a finished');
    assert.ok(observed.indexOf('start:c') > observed.indexOf('done:b'), 'c started after b finished');
  });

  it('compileSpec emits a phasePlan schema (inspect → apply → verify)', () => {
    const compiled = compileSpec('test objective with enough length to avoid vagueness filters', [
      {
        summary: 'finding one with enough length to clear the vagueness filter and look real',
        claims: ['concrete claim about file x.js handling the input correctly'],
        evidencePaths: ['x.js'],
        confidence: 'medium',
      },
    ]);
    assert.equal(compiled.rejected, false, compiled.reason || '');
    assert.ok(Array.isArray(compiled.structured.phasePlan));
    assert.deepEqual(
      compiled.structured.phasePlan.map((p) => p.id),
      ['inspect', 'apply', 'verify'],
    );
    const batches = groupPhasePlanByDeps(compiled.structured.phasePlan);
    assert.equal(batches.length, 3, 'serial chain today');
  });
});
