'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  capabilityForModel,
  normalizeEffort,
  normalizeThinkingMode,
  resolveModelControls,
} = require('../../src/runner/model-capabilities');

describe('model-aware effort and thinking controls', () => {
  it('accepts xhigh as a runner effort level', () => {
    assert.equal(normalizeEffort('XHIGH'), 'xhigh');
  });

  it('defaults the friendly thinking mode to auto', () => {
    assert.equal(normalizeThinkingMode(), 'auto');
  });

  it('omits the redundant thinking field for Fable 5', () => {
    const controls = resolveModelControls({
      model: 'claude-fable-5',
      effort: 'xhigh',
      thinking: 'auto',
    });

    assert.equal(controls.effort, 'xhigh');
    assert.equal(controls.thinkingConfig, null);
  });

  it('explicitly enables adaptive thinking for Sonnet 4.6 in auto mode', () => {
    const controls = resolveModelControls({ model: 'claude-sonnet-4-6' });
    assert.deepEqual(controls.thinkingConfig, { type: 'adaptive' });
  });

  it('explicitly enables adaptive thinking for current Opus models', () => {
    const controls = resolveModelControls({ model: 'claude-opus-4-8', thinking: 'adaptive' });
    assert.deepEqual(controls.thinkingConfig, { type: 'adaptive' });
  });

  it('omits thinking when an explicit-adaptive model is turned off', () => {
    const controls = resolveModelControls({ model: 'claude-opus-4-7', thinking: 'off' });
    assert.equal(controls.thinkingConfig, null);
  });

  it('sends disabled when default-on Sonnet 5 is turned off', () => {
    const controls = resolveModelControls({ model: 'claude-sonnet-5', thinking: 'off' });
    assert.deepEqual(controls.thinkingConfig, { type: 'disabled' });
  });

  it('rejects turning off thinking on always-on models', () => {
    assert.throws(
      () => resolveModelControls({ model: 'claude-fable-5', thinking: 'off' }),
      /adaptive thinking is always on/,
    );
  });

  it('rejects adaptive thinking on known older models', () => {
    assert.throws(
      () => resolveModelControls({ model: 'claude-sonnet-4-5', thinking: 'adaptive' }),
      /adaptive is not supported/,
    );
  });

  it('rejects xhigh on a known model that lacks that effort level', () => {
    assert.throws(
      () => resolveModelControls({ model: 'claude-sonnet-4-6', effort: 'xhigh' }),
      /Supported levels: low, medium, high, max/,
    );
  });

  it('keeps unknown future model IDs permissive', () => {
    const controls = resolveModelControls({
      model: 'claude-future-9',
      effort: 'xhigh',
      thinking: 'adaptive',
    });

    assert.deepEqual(controls.thinkingConfig, { type: 'adaptive' });
    assert.equal(capabilityForModel('claude-future-9').thinking, 'unknown');
  });
});
