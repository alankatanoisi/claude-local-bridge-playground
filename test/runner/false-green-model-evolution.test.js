'use strict';

/**
 * false-green-model-evolution.test.js — FG-H series.
 *
 * SCENARIO THIS FILE DEFENDS (hypothetical change HC-1):
 *   "Anthropic ships claude-opus-5-1. Add it to the model catalog with its own
 *    pricing, context window, and effort levels."
 *
 * Why the existing suite would stay 100% green through a broken version of that
 * change: FG-D9 already checks that every catalog entry is *internally*
 * coherent (positive prices, output <= context, sane price ordering). An entry
 * can satisfy every one of those checks and still be COMPLETELY DEAD CODE,
 * because `catalogEntryForModel` scans CATALOG_ENTRIES in order and returns the
 * FIRST regex that matches.
 *
 * That is not hypothetical. Today, with no new entry at all:
 *
 *     catalogEntryForModel('claude-opus-5-1')  ->  Claude Opus 5
 *
 * because the existing matcher is /^claude-opus-5(?:$|-)/ and the `-` branch
 * swallows every dashed suffix. So an author who appends a new
 * `^claude-opus-5-1(?:$|-)` entry at the end of the array gets: a well-formed
 * entry, a green suite, and pricing/context numbers that are still Opus 5's.
 * A 10x pricing error would ship silently.
 *
 * FG-H1 is the guard: every entry must be reachable by its own canonical id.
 *
 * The rest of the series covers the other silent-drift channels a model
 * addition opens: version/provenance bookkeeping (H3-H5), the hand-maintained
 * back-compat pricing map (H6), the default-model contract (H7), and the
 * honesty rules for unknown/estimated models (H9-H11).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');

const catalog = require('../../src/runner/model-catalog');
const pricing = require('../../src/runner/model-pricing');
const capabilities = require('../../src/runner/model-capabilities');

const REPO = path.resolve(__dirname, '..', '..');

/**
 * Derive the concrete model id(s) an entry's matcher is *meant* to own.
 *
 * The catalog uses two regex shapes:
 *   /^claude-opus-5(?:$|-)/        -> one id:  claude-opus-5
 *   /^claude-opus-4-(?:8|7)(?:$|-)/ -> two ids: claude-opus-4-8, claude-opus-4-7
 *
 * Anything else fails loudly rather than being silently skipped — a matcher
 * shape this helper cannot read is a matcher this test cannot protect.
 */
function canonicalIdsFor(re) {
  let src = re.source;
  assert.ok(src.startsWith('^'), 'matcher must be anchored: ' + src);
  src = src.slice(1);
  // Drop the trailing optional-suffix group the catalog uses everywhere.
  src = src.replace(/\(\?:\$\|-\)$/, '');

  // Expand at most one literal alternation group.
  const alt = src.match(/^([^(]*)\(\?:([^)]*)\)([^(]*)$/);
  if (alt) {
    const [, head, body, tail] = alt;
    const branches = body.split('|');
    for (const b of branches) {
      assert.ok(/^[a-z0-9-]*$/.test(b), 'FG-H1 cannot expand alternation branch "' + b + '" in ' + re.source);
    }
    return branches.map((b) => head + b + tail);
  }

  assert.ok(
    /^[a-z0-9-]+$/.test(src),
    'FG-H1 cannot derive a canonical id from matcher ' + re.source + ' — teach canonicalIdsFor() this shape.',
  );
  return [src];
}

describe('FG-H catalog reachability (the shadowed-entry trap)', () => {
  // FG-H1: THE headline guard for HC-1. First-match-wins means a new entry
  // placed after a broader sibling never runs. Every entry must resolve to
  // ITSELF when queried with the id it claims to own.
  it('FG-H1: every catalog entry is reachable by its own canonical model id', () => {
    const unreachable = [];
    for (const entry of catalog.CATALOG_ENTRIES) {
      for (const id of canonicalIdsFor(entry.matches)) {
        const resolved = catalog.catalogEntryForModel(id);
        if (!resolved || resolved.label !== entry.label) {
          unreachable.push(`${entry.label} (id "${id}") is shadowed by "${resolved ? resolved.label : 'NO MATCH'}"`);
        }
      }
    }
    assert.deepEqual(
      unreachable,
      [],
      'Catalog entries that can never be selected:\n  ' +
        unreachable.join('\n  ') +
        '\n\ncatalogEntryForModel() returns the FIRST matching entry. A matcher like\n' +
        '/^claude-opus-5(?:$|-)/ already matches "claude-opus-5-1", so a more specific\n' +
        'entry must be placed BEFORE its broader sibling, not appended at the end.',
    );
  });

  // FG-H2: makes today's shadowing visible instead of leaving it as folklore.
  // These are the ids a "point release" would arrive under. The snapshot says
  // which entry currently claims them; when a real entry is added for one of
  // these ids, this map must change in the same commit (and FG-H1 enforces
  // that the new entry is actually reachable).
  it('FG-H2: point-release ids resolve to their documented owner', () => {
    const probes = {
      'claude-opus-5-1': 'Claude Opus 5',
      'claude-sonnet-5-1': 'Claude Sonnet 5',
      'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
      'claude-fable-5-2': 'Claude Fable 5',
    };
    const actual = {};
    for (const id of Object.keys(probes)) {
      const e = catalog.catalogEntryForModel(id);
      actual[id] = e ? e.label : null;
    }
    assert.deepEqual(
      actual,
      probes,
      'A dashed-suffix model id changed owners. If you added a dedicated entry for a\n' +
        'point release, update this map — and make sure the new entry sits ABOVE the\n' +
        'broader family matcher so FG-H1 passes.',
    );
  });
});

describe('FG-H catalog bookkeeping', () => {
  /** Stable digest of every fact the catalog asserts about models. */
  function catalogFingerprint() {
    const shape = catalog.CATALOG_ENTRIES.map((e) => [
      e.matches.source,
      e.label,
      e.contextWindow,
      e.maxOutputTokens,
      e.effortLevels,
      e.thinking,
      e.sampling,
      e.lifecycle,
      e.pricing,
      e.pricingSource || null,
      e.provenance || null,
    ]);
    return crypto.createHash('sha256').update(JSON.stringify(shape)).digest('hex').slice(0, 16);
  }

  // FG-H3: CATALOG_VERSION is the string consumers surface in "your catalog may
  // be stale" warnings. Nothing forced it to change when the facts changed, so
  // a new model could ship under a version string dated weeks earlier and every
  // staleness report would be a lie. Pinning (fingerprint, version) as a PAIR
  // makes editing the data without re-dating it a hard failure.
  it('FG-H3: changing catalog facts requires bumping CATALOG_VERSION', () => {
    const PINNED_FINGERPRINT = '6493d4f165ee966d';
    const PINNED_VERSION = '2026-07-26-context-limits';

    if (catalogFingerprint() !== PINNED_FINGERPRINT) {
      assert.notEqual(
        catalog.CATALOG_VERSION,
        PINNED_VERSION,
        'Catalog entries changed but CATALOG_VERSION is still "' +
          PINNED_VERSION +
          '".\nConsumers report that string as the provenance of their numbers, so a stale\n' +
          'version makes every downstream warning inaccurate. Bump CATALOG_VERSION, then\n' +
          'update PINNED_FINGERPRINT (' +
          catalogFingerprint() +
          ') and PINNED_VERSION here.',
      );
    }
  });

  // FG-H4: `provenance` is a foreign key into CATALOG_SOURCES. A typo, or a
  // source removed during cleanup, leaves an entry citing a source that does
  // not exist — the fact looks sourced and is not.
  it('FG-H4: every entry provenance resolves to a declared source', () => {
    const sourceIds = new Set(catalog.CATALOG_SOURCES.map((s) => s.id));
    const dangling = catalog.CATALOG_ENTRIES.filter((e) => e.provenance && !sourceIds.has(e.provenance)).map(
      (e) => `${e.label} -> "${e.provenance}"`,
    );
    assert.deepEqual(
      dangling,
      [],
      'Entries cite a provenance id that is not in CATALOG_SOURCES:\n  ' + dangling.join('\n  '),
    );
  });

  // FG-H5: source records must stay honest about how the fact was obtained.
  it('FG-H5: every catalog source declares a known verification status and a date', () => {
    const VALID = new Set(['verified-live', 'local-experiment', 'unverified']);
    for (const s of catalog.CATALOG_SOURCES) {
      assert.ok(VALID.has(s.status), `source ${s.id}: unknown status "${s.status}"`);
      assert.match(String(s.checked), /^\d{4}-\d{2}-\d{2}$/, `source ${s.id}: "checked" must be an ISO date`);
      assert.ok(s.url && String(s.url).length > 0, `source ${s.id}: missing url`);
    }
  });

  // FG-H6: PRICING_PER_MILLION is a HAND-MAINTAINED back-compat map. Adding a
  // model to the catalog does not add it here, and nothing cross-checked the
  // two — so a consumer indexing by key could read a different price than
  // resolveRates() returns for the same model.
  it('FG-H6: the back-compat pricing map agrees with catalog resolution', () => {
    for (const [model, rates] of Object.entries(pricing.PRICING_PER_MILLION)) {
      if (model === 'default') continue;
      assert.deepEqual(
        rates,
        pricing.resolveRates(model),
        `PRICING_PER_MILLION["${model}"] disagrees with resolveRates("${model}") — ` +
          'the hand-maintained map has drifted from the catalog.',
      );
      assert.equal(
        pricing.resolveRatesDetailed(model).source,
        'catalog',
        `PRICING_PER_MILLION lists "${model}" but the catalog only resolves it by estimate — ` +
          'the map implies a verified price that does not exist.',
      );
    }
  });
});

describe('FG-H default-model and honesty contracts', () => {
  // FG-H7: FG-D10 already proves DEFAULT_MODEL is a known, active, catalog-priced
  // entry. What nothing checked is that the RUNNER's default and the BRIDGE's
  // default are the same model — they are declared in two different files
  // (model-catalog.js and the VS Code contribution block in package.json), and a
  // model bump naturally touches only one of them.
  it('FG-H7: the runner default model and the extension default model agree', () => {
    const pkg = require(path.join(REPO, 'package.json'));
    const contributed = pkg.contributes.configuration.properties['claudeLocalBridge.defaultModel'].default;
    assert.equal(
      contributed,
      catalog.DEFAULT_MODEL,
      'package.json claudeLocalBridge.defaultModel and model-catalog DEFAULT_MODEL disagree — ' +
        'the bridge and the runner would default to different models.',
    );
  });

  // FG-H8: entries share effort-level array references (STANDARD_EFFORT /
  // XHIGH_EFFORT). If one of those were mutable, a single push() — in product
  // code or in a test running earlier in the same process — would grant that
  // effort level to every model in the family at once.
  it('FG-H8: shared effort-level arrays are frozen', () => {
    assert.ok(Object.isFrozen(catalog.EFFORT_LEVELS), 'EFFORT_LEVELS must be frozen');
    assert.ok(Object.isFrozen(catalog.THINKING_MODES), 'THINKING_MODES must be frozen');
    for (const e of catalog.CATALOG_ENTRIES) {
      assert.ok(Object.isFrozen(e.effortLevels), `${e.label}: effortLevels array is mutable`);
      assert.ok(Object.isFrozen(e.pricing), `${e.label}: pricing object is mutable`);
    }
  });

  // FG-H9: FG-D11 proves an unknown model is not reported as catalog-priced.
  // It does NOT distinguish the two *kinds* of estimate, and that distinction
  // is what a new model release actually breaks. A brand-new `claude-opus-5-1`
  // falls into the FAMILY fallback (Opus 5's real rates, flagged as a guess),
  // while a genuinely unknown id falls to the GENERIC default. Collapsing the
  // two — or letting the family fallback borrow the sibling's label — would
  // present an inferred price with a real model's name attached to it.
  it('FG-H9: the two estimate tiers stay distinct and carry no borrowed identity', () => {
    const generic = pricing.resolveRatesDetailed('definitely-not-a-real-model-9');
    assert.equal(generic.source, 'default-estimate');
    assert.equal(generic.label, null, 'a generic estimate must not borrow another model’s label');
    assert.deepEqual(generic.rates, catalog.DEFAULT_PRICING);

    const family = pricing.resolveRatesDetailed('claude-opus-99-experimental');
    assert.equal(
      family.source,
      'family-estimate',
      'a claude-opus-* id must fall to the family tier, not the generic one',
    );
    assert.deepEqual(
      family.rates,
      pricing.resolveRates('claude-opus-5'),
      'family fallback must use the canonical rates',
    );
    assert.notEqual(family.rates, generic.rates, 'family and generic tiers must not collapse into one');

    // Both tiers must still carry the catalog version so staleness is reportable.
    const cap = capabilities.capabilityForModel('definitely-not-a-real-model-9');
    assert.equal(cap.catalogVersion, catalog.CATALOG_VERSION, 'unknown-model report must carry the catalog version');
  });

  // FG-H10: `pricingSource` is the per-entry override that marks a price as
  // inferred. Nothing validated the values it may take, so a typo
  // (`pricingSource: 'estimate'`) silently falls through to the default
  // 'catalog' label — presenting a guess as a verified rate.
  it('FG-H10: explicit pricingSource values are a known, honest enum', () => {
    for (const e of catalog.CATALOG_ENTRIES) {
      if (!e.pricingSource) continue;
      assert.notEqual(
        e.pricingSource,
        'catalog',
        `${e.label}: pricingSource "catalog" is the implicit default — setting it explicitly ` +
          'hides the fact that this price was inferred.',
      );
      assert.ok(
        ['family-estimate', 'default-estimate'].includes(e.pricingSource),
        `${e.label}: unknown pricingSource "${e.pricingSource}"`,
      );
    }
  });

  // FG-H11: lifecycle drives whether a model should be offered at all. An
  // unknown lifecycle value fails open today (it is just a string nobody reads
  // exhaustively), so pin the enum.
  it('FG-H11: every entry declares a known lifecycle, thinking and sampling value', () => {
    const LIFECYCLES = new Set(['active', 'limited-availability', 'deprecated', 'retired']);
    const THINKING = new Set(['always-on', 'default-on', 'explicit-adaptive', 'manual-only', 'manual-or-none']);
    const SAMPLING = new Set(['default-only', 'supported']);
    for (const e of catalog.CATALOG_ENTRIES) {
      assert.ok(LIFECYCLES.has(e.lifecycle), `${e.label}: unknown lifecycle "${e.lifecycle}"`);
      assert.ok(THINKING.has(e.thinking), `${e.label}: unknown thinking mode "${e.thinking}"`);
      assert.ok(SAMPLING.has(e.sampling), `${e.label}: unknown sampling mode "${e.sampling}"`);
      assert.notEqual(e.lifecycle, 'retired', `${e.label}: retired models must be removed, not left selectable`);
    }
  });

  // FG-H12: strictly stronger than FG-D12, which bills 1M of EVERY component at
  // once and compares against the sum of the four rates. That check is blind to
  // any permutation: if a refactor billed cache reads at the input rate and
  // input at the cache-read rate, the sum is byte-identical and FG-D12 stays
  // green — while a cache-heavy run (the normal case for this runner, which
  // pins a 1-hour cache TTL) is mis-billed by ~10x per token.
  // Billing each component ALONE pins every rate to its own dimension.
  it('FG-H12: each usage component contributes independently and linearly to cost', () => {
    const model = 'claude-sonnet-5';
    const rates = pricing.resolveRates(model);
    const M = 1_000_000;
    const components = [
      ['input_tokens', rates.input],
      ['output_tokens', rates.output],
      ['cache_read_input_tokens', rates.cache_read],
      ['cache_creation_input_tokens', rates.cache_write],
    ];

    for (const [field, rate] of components) {
      const one = pricing.estimateCostUsd(model, { [field]: M });
      assert.ok(
        Math.abs(one - rate) < 1e-9,
        `1M ${field} should cost exactly its own rate (${rate}), got ${one} — ` +
          'a component is being double-counted or dropped.',
      );
      const two = pricing.estimateCostUsd(model, { [field]: 2 * M });
      assert.ok(Math.abs(two - 2 * rate) < 1e-9, `${field} cost is not linear`);
    }

    // Sum of parts equals the whole: no component is silently folded into another.
    const all = pricing.estimateCostUsd(model, {
      input_tokens: M,
      output_tokens: M,
      cache_read_input_tokens: M,
      cache_creation_input_tokens: M,
    });
    const expected = rates.input + rates.output + rates.cache_read + rates.cache_write;
    assert.ok(Math.abs(all - expected) < 1e-9, `combined cost ${all} != sum of components ${expected}`);
  });
});
