'use strict';

/**
 * model-catalog.js — ONE versioned, provenance-backed model capability matrix (P1-07).
 *
 * Why this file exists:
 * Model/effort/thinking/pricing assumptions used to be scattered across
 * `model-capabilities.js` (regex rules), `model-pricing.js` (its own family
 * table), the runner CLI default, and the bridge default — and they disagreed.
 * This catalog is the single local source of truth that all of those consume.
 *
 * Honesty rules:
 * - The upstream Anthropic API remains the REAL source of truth. Unknown or
 *   future model IDs pass through unchanged; the catalog only validates what it
 *   positively knows and must never silently invent capabilities.
 * - Every entry records provenance (where the fact came from and when it was
 *   last checked). Consumers surface `catalogVersion` so stale-catalog reports
 *   are possible instead of silent fallback.
 * - For Anthropic facts, official sources come first: docs.anthropic.com,
 *   code.claude.com/docs, support.claude.com. Entries whose facts were only
 *   confirmed by local experiment (not a live doc fetch) say so.
 */

// Bump the version whenever an entry changes; consumers report it in warnings.
const CATALOG_VERSION = '2026-07-25';

// Where each class of fact came from. `status` is deliberately blunt:
// 'verified-live' means someone actually fetched the official page on that
// date; 'local-experiment' means behavior was confirmed against the API via
// the bridge; 'unverified' means inherited knowledge awaiting a live check.
const CATALOG_SOURCES = Object.freeze([
  {
    id: 'anthropic-models-overview',
    url: 'https://platform.claude.com/docs/en/about-claude/models/overview',
    status: 'verified-live',
    checked: '2026-07-25',
    note: 'Current model IDs, aliases, context windows, output limits, and latest-model comparison.',
  },
  {
    id: 'anthropic-pricing',
    url: 'https://platform.claude.com/docs/en/about-claude/pricing',
    status: 'verified-live',
    checked: '2026-07-25',
    note: 'Per-million token rates, including Sonnet 5 introductory pricing through 2026-08-31.',
  },
  {
    id: 'anthropic-effort',
    url: 'https://platform.claude.com/docs/en/build-with-claude/effort',
    status: 'verified-live',
    checked: '2026-07-25',
    note: 'Per-model effort support, including the xhigh and max availability matrix.',
  },
  {
    id: 'anthropic-thinking',
    url: 'https://platform.claude.com/docs/en/build-with-claude/thinking',
    status: 'verified-live',
    checked: '2026-07-25',
    note: 'Per-model adaptive-thinking defaults and supported thinking modes.',
  },
  {
    id: 'anthropic-opus-5',
    url: 'https://platform.claude.com/docs/en/about-claude/models/whats-new-opus-5',
    status: 'verified-live',
    checked: '2026-07-25',
    note: 'Opus 5 thinking defaults and the effort restriction when thinking is disabled.',
  },
  {
    id: 'anthropic-model-deprecations',
    url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations',
    status: 'verified-live',
    checked: '2026-07-25',
    note: 'Active, deprecated, and retired first-party Claude API model IDs.',
  },
  {
    id: 'runner-thinking-experiment',
    url: 'repo:docs (model-aware thinking controls experiment, commit 42a69e1)',
    status: 'local-experiment',
    checked: '2026-07-16',
    note: 'Per-family adaptive/manual/disabled thinking behavior observed through the bridge.',
  },
]);

// Runner-visible effort vocabulary. 'auto' is a RUNNER-LOCAL reset sentinel:
// it means "omit output_config.effort entirely" and is never sent upstream.
const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const EFFORT_AUTO = 'auto';
const STANDARD_EFFORT = Object.freeze(['low', 'medium', 'high', 'max']);
const XHIGH_EFFORT = EFFORT_LEVELS;

const THINKING_MODES = Object.freeze(['auto', 'adaptive', 'off']);

// Shared default model. The runner CLI and the bridge both read this constant
// so the two layers cannot drift apart again (P1-07 "defaults disagree").
const DEFAULT_MODEL = 'claude-sonnet-5';

// Shared per-family rate objects (single references, so identity comparisons
// across family members remain valid for consumers/tests).
const FABLE_PRICING = Object.freeze({ input: 10.0, output: 50.0, cache_read: 1.0, cache_write: 20.0 });
const OPUS_PRICING = Object.freeze({ input: 5.0, output: 25.0, cache_read: 0.5, cache_write: 10.0 });
const LEGACY_OPUS_PRICING = Object.freeze({ input: 15.0, output: 75.0, cache_read: 1.5, cache_write: 30.0 });
// Sonnet 5's $2/$10 introductory price is effective through 2026-08-31.
// The catalog is date-versioned so this deliberately visible temporary rate
// cannot masquerade as an evergreen price after its documented end date.
const SONNET_5_INTRO_PRICING = Object.freeze({ input: 2.0, output: 10.0, cache_read: 0.2, cache_write: 4.0 });
const SONNET_PRICING = Object.freeze({ input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 6.0 });
const HAIKU_PRICING = Object.freeze({ input: 1.0, output: 5.0, cache_read: 0.1, cache_write: 2.0 });
const BASE_EFFORT = Object.freeze(['low', 'medium', 'high']);
const THINKING_OFF_EFFORT = BASE_EFFORT;

/**
 * Catalog entries. Date-suffixed IDs still match because every pattern accepts
 * either end-of-ID or another hyphen after the family name.
 *
 * thinking values:
 *   'always-on'         cannot be disabled; sending a thinking field is redundant
 *   'default-on'        on unless explicitly `{type:'disabled'}`; an entry may
 *                       further restrict which effort levels permit disabling
 *   'explicit-adaptive' needs `{type:'adaptive'}` to enable; omit to leave off
 *   'manual-only'       legacy budgeted thinking only; adaptive rejected
 *   'manual-or-none'    legacy models; adaptive rejected
 */
const CATALOG_ENTRIES = Object.freeze([
  {
    matches: /^claude-fable-5(?:$|-)/,
    label: 'Claude Fable 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'always-on',
    sampling: 'default-only',
    lifecycle: 'active',
    pricing: FABLE_PRICING,
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-mythos-5(?:$|-)/,
    label: 'Claude Mythos 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'always-on',
    sampling: 'default-only',
    lifecycle: 'limited-availability',
    pricing: FABLE_PRICING,
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-mythos-preview(?:$|-)/,
    label: 'Claude Mythos Preview',
    effortLevels: STANDARD_EFFORT,
    thinking: 'always-on',
    sampling: 'default-only',
    lifecycle: 'limited-availability',
    // Anthropic no longer publishes a separate Preview price in the current
    // table. Use the successor Mythos family rate, but label it as an estimate
    // rather than presenting it as an exact catalog price.
    pricing: FABLE_PRICING,
    pricingSource: 'family-estimate',
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-opus-5(?:$|-)/,
    label: 'Claude Opus 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'default-on',
    thinkingOffEffortLevels: THINKING_OFF_EFFORT,
    sampling: 'default-only',
    lifecycle: 'active',
    pricing: OPUS_PRICING,
    provenance: 'anthropic-opus-5',
  },
  {
    matches: /^claude-sonnet-5(?:$|-)/,
    label: 'Claude Sonnet 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'default-on',
    sampling: 'default-only',
    lifecycle: 'active',
    pricing: SONNET_5_INTRO_PRICING,
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-opus-4-(?:8|7)(?:$|-)/,
    label: 'Claude Opus 4.7/4.8',
    effortLevels: XHIGH_EFFORT,
    thinking: 'explicit-adaptive',
    sampling: 'default-only',
    lifecycle: 'active',
    pricing: OPUS_PRICING,
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-opus-4-6(?:$|-)/,
    label: 'Claude Opus 4.6',
    effortLevels: STANDARD_EFFORT,
    thinking: 'explicit-adaptive',
    sampling: 'supported',
    lifecycle: 'active',
    pricing: OPUS_PRICING,
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-sonnet-4-6(?:$|-)/,
    label: 'Claude Sonnet 4.6',
    effortLevels: STANDARD_EFFORT,
    thinking: 'explicit-adaptive',
    sampling: 'supported',
    lifecycle: 'active',
    pricing: SONNET_PRICING,
    provenance: 'anthropic-thinking',
  },
  {
    matches: /^claude-opus-4-5(?:$|-)/,
    label: 'Claude Opus 4.5',
    effortLevels: BASE_EFFORT,
    thinking: 'manual-only',
    sampling: 'supported',
    lifecycle: 'active',
    pricing: OPUS_PRICING,
    provenance: 'anthropic-effort',
  },
  {
    matches: /^claude-opus-4-1(?:$|-)/,
    label: 'Claude Opus 4.1',
    effortLevels: null,
    thinking: 'manual-only',
    sampling: 'supported',
    lifecycle: 'deprecated',
    pricing: LEGACY_OPUS_PRICING,
    provenance: 'anthropic-model-deprecations',
  },
  {
    matches: /^claude-haiku-4-5(?:$|-)/,
    label: 'Claude Haiku 4.5',
    effortLevels: null,
    thinking: 'manual-or-none',
    sampling: 'supported',
    lifecycle: 'active',
    pricing: HAIKU_PRICING,
    provenance: 'anthropic-models-overview',
  },
  {
    matches: /^claude-sonnet-4-5(?:$|-)/,
    label: 'Claude Sonnet 4.5',
    effortLevels: null,
    thinking: 'manual-or-none',
    sampling: 'supported',
    lifecycle: 'active',
    pricing: SONNET_PRICING,
    provenance: 'anthropic-models-overview',
  },
]);

// Family fallbacks for PRICING ONLY (capability validation never falls back —
// unknown models stay permissive-and-reported instead). Keys point at the
// newest known family member so estimates skew current, and callers are told
// the number is a family estimate rather than an exact published rate.
const PRICING_FAMILY_FALLBACKS = Object.freeze([
  { prefix: 'claude-opus', canonical: 'claude-opus-5' },
  { prefix: 'claude-fable', canonical: 'claude-fable-5' },
  { prefix: 'claude-mythos', canonical: 'claude-mythos-5' },
  { prefix: 'claude-sonnet', canonical: 'claude-sonnet-5' },
  { prefix: 'claude-haiku', canonical: 'claude-haiku-4-5' },
]);

const DEFAULT_PRICING = Object.freeze({ input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 6.0 });

/** Find the catalog entry for a model ID, or null when the model is unknown. */
function catalogEntryForModel(model) {
  const modelId = String(model || '').toLowerCase();
  return CATALOG_ENTRIES.find((entry) => entry.matches.test(modelId)) || null;
}

/**
 * Pricing lookup with explicit provenance — never a silent fallback.
 * Returns { rates, source, label } where source is 'catalog',
 * 'family-estimate', or 'default-estimate'. Callers surface non-'catalog'
 * sources so cost numbers are labeled as estimates, not published rates.
 */
function pricingForModel(model) {
  const entry = catalogEntryForModel(model);
  if (entry) return { rates: entry.pricing, source: entry.pricingSource || 'catalog', label: entry.label };
  const modelId = String(model || '').toLowerCase();
  for (const { prefix, canonical } of PRICING_FAMILY_FALLBACKS) {
    if (modelId.startsWith(prefix)) {
      const canonicalEntry = catalogEntryForModel(canonical);
      if (canonicalEntry) {
        return { rates: canonicalEntry.pricing, source: 'family-estimate', label: canonicalEntry.label };
      }
    }
  }
  return { rates: DEFAULT_PRICING, source: 'default-estimate', label: null };
}

module.exports = {
  CATALOG_VERSION,
  CATALOG_SOURCES,
  CATALOG_ENTRIES,
  DEFAULT_MODEL,
  DEFAULT_PRICING,
  EFFORT_LEVELS,
  EFFORT_AUTO,
  STANDARD_EFFORT,
  XHIGH_EFFORT,
  THINKING_MODES,
  catalogEntryForModel,
  pricingForModel,
};
