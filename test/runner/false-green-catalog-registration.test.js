'use strict';

/**
 * false-green-catalog-registration.test.js — surface-expansion guards (FG-D).
 *
 * The classic false-green after "add a new tool / model": the suite tests
 * everything that IS registered, so a half-registered addition changes the
 * runner's surface without touching a single existing assertion. These tests
 * make registration itself the thing under test.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  TOOLS,
  TOOL_MODULES,
  CATEGORIES,
  CAPABILITY_GROUPS,
  TOOL_GROUPS,
  OPTIONAL_CAPABILITIES,
  DEFAULT_HIDDEN_TOOLS,
} = require('../../src/runner/tool-catalog');
const { isToolVisible, normalizeCapabilityList } = require('../../src/runner/tool-visibility');
const { EFFECTFUL_CATEGORIES } = require('../../src/runner/authority');
const catalog = require('../../src/runner/model-catalog');
const pricing = require('../../src/runner/model-pricing');
const capabilities = require('../../src/runner/model-capabilities');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'src', 'runner', 'tools');

describe('FG-D tool-module registration completeness', () => {
  // Files under tools/ that are shared machinery, not tools. A NEW file that
  // is neither here nor in TOOL_MODULES fails loudly — the author must decide
  // which it is instead of shipping an orphan.
  const KNOWN_HELPERS = new Set(['_file-cache.js', '_search-cache.js', 'file-write-utils.js', 'persistent-shell.js']);

  it('FG-D1: every file in src/runner/tools is either a registered tool or a known helper', () => {
    const files = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith('.js'));
    const unregistered = [];
    for (const file of files) {
      const mod = require(path.join(TOOLS_DIR, file));
      if (KNOWN_HELPERS.has(file)) {
        // A helper that grows the full tool shape must move to registration.
        // Boolean() matters: a missing `meta` makes the && chain undefined, and
        // assert.equal(undefined, false) fails even though the intent holds.
        const looksLikeTool = Boolean(
          mod && mod.meta && typeof mod.definition === 'function' && typeof mod.execute === 'function',
        );
        assert.equal(
          looksLikeTool,
          false,
          file + ' is listed as a helper but exports a full tool shape; register it in TOOL_MODULES or rename it',
        );
        continue;
      }
      if (!TOOL_MODULES.includes(mod)) {
        unregistered.push(file);
      }
    }
    assert.deepEqual(
      unregistered,
      [],
      'Tool file(s) exist but are NOT registered in tool-catalog TOOL_MODULES: ' +
        unregistered.join(', ') +
        '. An unregistered tool silently misses permissions, visibility, and compaction wiring.',
    );
  });

  it('FG-D2: every registered tool declares a category the permission MODES tables know', () => {
    const { MODES } = require('../../src/runner/permissions');
    for (const [name, category] of Object.entries(CATEGORIES)) {
      for (const [mode, rules] of Object.entries(MODES)) {
        assert.ok(
          rules[category] !== undefined,
          'tool ' + name + ' category "' + category + '" has no decision in MODES.' + mode,
        );
      }
    }
  });
});

describe('FG-D capability-group safety invariants', () => {
  it('FG-D3: shell is never reachable through --capabilities', () => {
    assert.ok(!OPTIONAL_CAPABILITIES.includes('shell'), 'shell must not be an optional capability');
    assert.throws(() => normalizeCapabilityList('shell'), /allow-shell/);
  });

  it('FG-D4: the core group contains no effectful tools', () => {
    // Core is the no-flag default surface. A new tool dropped into core with
    // an effectful category would widen the default surface silently.
    for (const name of CAPABILITY_GROUPS.core) {
      assert.ok(
        !EFFECTFUL_CATEGORIES.has(CATEGORIES[name]),
        'core tool ' + name + ' has effectful category ' + CATEGORIES[name],
      );
    }
  });

  it('FG-D5: every shell-category tool lives in the shell group, and vice versa', () => {
    for (const [name, category] of Object.entries(CATEGORIES)) {
      if (category === 'shell') {
        assert.equal(TOOL_GROUPS[name], 'shell', name + ' is shell-category but in group ' + TOOL_GROUPS[name]);
      }
      if (TOOL_GROUPS[name] === 'shell') {
        assert.equal(category, 'shell', name + ' is in the shell group but has category ' + category);
      }
    }
  });

  it('FG-D6: apply_patch stays hidden-by-default inside the edits group', () => {
    assert.equal(TOOL_GROUPS.apply_patch, 'edits');
    assert.ok(DEFAULT_HIDDEN_TOOLS.has('apply_patch'), 'apply_patch must stay hidden without an exact --tools optin');
    assert.equal(isToolVisible('apply_patch', { enabledCapabilities: new Set(['edits']) }), false);
  });

  it('FG-D7: the no-flag default surface is exactly the visible core (snapshot)', () => {
    // Deliberate change-detector: enlarging the default surface must be a
    // conscious, reviewed edit to this list — not a side effect.
    const visible = Object.keys(TOOLS)
      .filter((name) => isToolVisible(name, {}))
      .sort();
    assert.deepEqual(visible, [
      'ask_user_question',
      'git_status',
      'glob',
      'list_files',
      'manage_tasks',
      'read_file',
      'search_text',
    ]);
  });

  it('FG-D8: shell-category tools are invisible in every ctx that lacks allowShell', () => {
    for (const [name, category] of Object.entries(CATEGORIES)) {
      if (category !== 'shell') continue;
      assert.equal(isToolVisible(name, {}), false, name + ' visible without allowShell');
      assert.equal(
        isToolVisible(name, { enabledCapabilities: new Set(OPTIONAL_CAPABILITIES) }),
        false,
        name + ' visible via capability groups without allowShell',
      );
    }
  });
});

describe('FG-D model catalog cross-consistency', () => {
  it('FG-D9: every catalog entry is internally coherent', () => {
    for (const entry of catalog.CATALOG_ENTRIES) {
      const label = entry.label || String(entry.matches);
      assert.ok(entry.matches instanceof RegExp, label + ': matches must be a RegExp');
      assert.ok(entry.matches.source.startsWith('^claude'), label + ': matcher must anchor on ^claude');
      assert.ok(entry.contextWindow >= 8000, label + ': contextWindow implausibly small');
      assert.ok(entry.maxOutputTokens >= 1000, label + ': maxOutputTokens implausibly small');
      assert.ok(entry.maxOutputTokens <= entry.contextWindow, label + ': maxOutputTokens exceeds contextWindow');
      for (const key of ['input', 'output', 'cache_read', 'cache_write']) {
        assert.ok(entry.pricing[key] > 0, label + ': pricing.' + key + ' must be positive');
      }
      // Anthropic price-shape sanity: output > input, cache_read < input,
      // cache_write > input. A transposed row in a catalog refresh fails here.
      assert.ok(entry.pricing.output > entry.pricing.input, label + ': output rate should exceed input rate');
      assert.ok(entry.pricing.cache_read < entry.pricing.input, label + ': cache_read should be below input');
      assert.ok(entry.pricing.cache_write > entry.pricing.input, label + ': cache_write should exceed input');
      for (const level of entry.effortLevels || []) {
        assert.ok(catalog.EFFORT_LEVELS.includes(level), label + ': unknown effort level ' + level);
      }
    }
  });

  it('FG-D10: the default model resolves to an active catalog entry with published pricing', () => {
    const entry = catalog.catalogEntryForModel(catalog.DEFAULT_MODEL);
    assert.ok(entry, 'DEFAULT_MODEL "' + catalog.DEFAULT_MODEL + '" has no catalog entry');
    assert.equal(entry.lifecycle, 'active', 'DEFAULT_MODEL must not default to a non-active lifecycle');
    assert.equal(catalog.pricingForModel(catalog.DEFAULT_MODEL).source, 'catalog');
  });

  it('FG-D11: unknown models never masquerade as catalog-priced or catalog-validated', () => {
    const p = catalog.pricingForModel('claude-invented-model-99');
    assert.notEqual(p.source, 'catalog', 'unknown model pricing must be labeled an estimate');
    const cap = capabilities.capabilityForModel('totally-unknown-model');
    assert.equal(cap.known, false, 'unknown model must report known:false (permissive but never silent)');
    assert.equal(
      pricing.summarizeUsage('totally-unknown-model', { input_tokens: 10 }).pricingSource !== 'catalog',
      true,
    );
  });

  it('FG-D12: cost arithmetic matches published rates component-by-component', () => {
    const rates = catalog.pricingForModel(catalog.DEFAULT_MODEL).rates;
    const oneMillionEach = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
    };
    const cost = pricing.estimateCostUsd(catalog.DEFAULT_MODEL, oneMillionEach);
    const expected = rates.input + rates.output + rates.cache_read + rates.cache_write;
    assert.ok(Math.abs(cost - expected) < 1e-9, 'cost math drifted: got ' + cost + ' expected ' + expected);
  });

  it('FG-D13: model controls are validated against the catalog, not against a shadow list', () => {
    // Fable/Mythos are always-on thinking + default-only sampling: both
    // restrictions must reject the bad request BEFORE any HTTP happens.
    const fable = capabilities.capabilityForModel('claude-fable-5');
    assert.equal(fable.known, true);
    assert.throws(
      () => capabilities.resolveModelControls({ model: 'claude-fable-5', thinking: 'off' }),
      /thinking off is not supported/,
    );
    assert.throws(
      () => capabilities.resolveModelControls({ model: 'claude-fable-5', temperature: 0.2 }),
      /temperature is not supported/,
    );
    // Effort levels come from the entry itself: a level missing from the
    // entry must be rejected for that model even though it is globally valid.
    for (const entry of catalog.CATALOG_ENTRIES) {
      const levels = Array.isArray(entry.effortLevels) ? entry.effortLevels : [];
      const missing = catalog.EFFORT_LEVELS.filter((l) => !levels.includes(l));
      if (missing.length === 0) continue;
      const sampleModel = entry.matches.source.replace(/^\^/, '').replace(/\(.*$/, '');
      const cap = capabilities.capabilityForModel(sampleModel);
      if (!cap.known) continue; // matcher shapes that need a suffix — skip
      // validateEffortForModel is internal; resolveModelControls is the public
      // entry point that runs it. Going through the public API also proves the
      // validation actually fires on the path the runner uses.
      assert.throws(
        () => capabilities.resolveModelControls({ model: sampleModel, effort: missing[0] }),
        /not supported by (known )?model/,
        entry.label + ' must reject effort ' + missing[0],
      );
    }
  });
});
