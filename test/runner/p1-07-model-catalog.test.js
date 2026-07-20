'use strict';

/**
 * P1-07 — one versioned, provenance-backed model capability matrix.
 *
 * Contract under test:
 *   - capabilities, pricing, and the shared default model all come from
 *     model-catalog.js (no independent tables that can drift)
 *   - `--effort auto` is a runner-local reset sentinel: accepted, never sent
 *   - unknown models stay permissive but produce an explicit warning that
 *     names the catalog version (reported, never silent)
 *   - pricing lookups report their provenance (catalog / family-estimate /
 *     default-estimate)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../../src/runner/model-catalog');
const { resolveModelControls, capabilityForModel } = require('../../src/runner/model-capabilities');
const { resolveRatesDetailed, summarizeUsage } = require('../../src/runner/model-pricing');

describe('P1-07 model catalog', () => {
  it('has a version and provenance-annotated sources', () => {
    assert.match(catalog.CATALOG_VERSION, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(catalog.CATALOG_SOURCES.length > 0);
    for (const source of catalog.CATALOG_SOURCES) {
      assert.ok(source.id && source.url && source.status, 'every source names id/url/status');
    }
    for (const entry of catalog.CATALOG_ENTRIES) {
      assert.ok(
        catalog.CATALOG_SOURCES.some((s) => s.id === entry.provenance),
        entry.label + ' cites a declared source',
      );
      assert.ok(entry.pricing, entry.label + ' carries pricing');
    }
  });

  it('runner and bridge share one default model', () => {
    const bridgeModels = require('../../src/models.js');
    assert.equal(bridgeModels.DEFAULT_MODEL, catalog.DEFAULT_MODEL);
    // package.json setting default must match too (docs/CLI drift guard).
    const pkg = require('../../package.json');
    assert.equal(
      pkg.contributes.configuration.properties['claudeLocalBridge.defaultModel'].default,
      catalog.DEFAULT_MODEL,
    );
  });

  it('--effort auto is a reset sentinel that omits the field entirely', () => {
    const controls = resolveModelControls({ model: 'claude-sonnet-4-6', effort: 'auto' });
    assert.equal(controls.effort, null, 'auto normalizes to null (omit output_config)');
    assert.equal(controls.warnings.length, 0);
    // 'auto' works even on models where explicit effort is unsupported —
    // because nothing gets sent.
    const legacy = resolveModelControls({ model: 'claude-sonnet-4-5', effort: 'auto' });
    assert.equal(legacy.effort, null);
  });

  it('unknown models are permissive but REPORTED with the catalog version', () => {
    const controls = resolveModelControls({ model: 'claude-future-9', effort: 'xhigh', thinking: 'adaptive' });
    assert.equal(controls.capability.known, false);
    assert.equal(controls.warnings.length, 1);
    assert.match(controls.warnings[0], /not in the local capability catalog/);
    assert.ok(controls.warnings[0].includes(catalog.CATALOG_VERSION), 'warning names the catalog version');
    // Known models carry known: true and the same version tag.
    assert.equal(capabilityForModel('claude-sonnet-4-6').known, true);
    assert.equal(capabilityForModel('claude-sonnet-4-6').catalogVersion, catalog.CATALOG_VERSION);
  });

  it('invalid effort values list auto in the error message', () => {
    assert.throws(() => resolveModelControls({ model: 'claude-sonnet-4-6', effort: 'turbo' }), /auto, low, medium/);
  });

  it('pricing lookups report provenance instead of silently falling back', () => {
    assert.equal(resolveRatesDetailed('claude-sonnet-4-6').source, 'catalog');
    assert.equal(resolveRatesDetailed('claude-opus-4-9').source, 'family-estimate');
    assert.equal(resolveRatesDetailed('totally-unknown-model').source, 'default-estimate');
    assert.equal(resolveRatesDetailed('claude-sonnet-4-6').catalogVersion, catalog.CATALOG_VERSION);
    // The usage summary carries the source so downstream sinks can label it.
    const s = summarizeUsage('claude-opus-4-9', { input_tokens: 10 });
    assert.equal(s.pricingSource, 'family-estimate');
  });

  it('per-model validation still rejects unsupported combinations locally', () => {
    assert.throws(() => resolveModelControls({ model: 'claude-sonnet-4-6', effort: 'xhigh' }), /Supported levels/);
    assert.throws(() => resolveModelControls({ model: 'claude-sonnet-4-5', thinking: 'adaptive' }), /not supported/);
    assert.throws(() => resolveModelControls({ model: 'claude-fable-5', thinking: 'off' }), /always on/);
  });
});
