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
const CATALOG_VERSION = '2026-07-20';

// Where each class of fact came from. `status` is deliberately blunt:
// 'verified-live' means someone actually fetched the official page on that
// date; 'local-experiment' means behavior was confirmed against the API via
// the bridge; 'unverified' means inherited knowledge awaiting a live check.
const CATALOG_SOURCES = Object.freeze([
  {
    id: 'anthropic-models-overview',
    url: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    status: 'unverified',
    note: 'Model list/context/output facts. Re-verify on next networked session.',
  },
  {
    id: 'anthropic-pricing',
    url: 'https://docs.anthropic.com/en/docs/about-claude/pricing',
    status: 'unverified',
    note: 'Per-million token rates incl. 1h-TTL cache multipliers (2.0x write, 0.1x read).',
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
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Shared per-family rate objects (single references, so identity comparisons
// across family members remain valid for consumers/tests).
const OPUS_PRICING = Object.freeze({ input: 15.0, output: 75.0, cache_read: 1.5, cache_write: 30.0 });
const SONNET_PRICING = Object.freeze({ input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 6.0 });
const HAIKU_PRICING = Object.freeze({ input: 0.8, output: 4.0, cache_read: 0.08, cache_write: 1.6 });

/**
 * Catalog entries. Date-suffixed IDs still match because every pattern accepts
 * either end-of-ID or another hyphen after the family name.
 *
 * thinking values:
 *   'always-on'         cannot be disabled; sending a thinking field is redundant
 *   'default-on'        on unless explicitly `{type:'disabled'}`
 *   'explicit-adaptive' needs `{type:'adaptive'}` to enable; omit to leave off
 *   'manual-only'       legacy budgeted thinking only; adaptive rejected
 *   'manual-or-none'    legacy models; adaptive rejected
 */
const CATALOG_ENTRIES = Object.freeze([
  {
    matches: /^claude-(?:fable|mythos)-5(?:$|-)/,
    label: 'Claude Fable/Mythos 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'always-on',
    pricing: OPUS_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-mythos-preview(?:$|-)/,
    label: 'Claude Mythos Preview',
    effortLevels: STANDARD_EFFORT,
    thinking: 'always-on',
    pricing: OPUS_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-sonnet-5(?:$|-)/,
    label: 'Claude Sonnet 5',
    effortLevels: XHIGH_EFFORT,
    thinking: 'default-on',
    pricing: SONNET_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-opus-4-(?:8|7)(?:$|-)/,
    label: 'Claude Opus 4.7/4.8',
    effortLevels: XHIGH_EFFORT,
    thinking: 'explicit-adaptive',
    pricing: OPUS_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-opus-4-6(?:$|-)/,
    label: 'Claude Opus 4.6',
    effortLevels: STANDARD_EFFORT,
    thinking: 'explicit-adaptive',
    pricing: OPUS_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-sonnet-4-6(?:$|-)/,
    label: 'Claude Sonnet 4.6',
    effortLevels: STANDARD_EFFORT,
    thinking: 'explicit-adaptive',
    pricing: SONNET_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-opus-4-5(?:$|-)/,
    label: 'Claude Opus 4.5',
    effortLevels: STANDARD_EFFORT,
    thinking: 'manual-only',
    pricing: OPUS_PRICING,
    provenance: 'runner-thinking-experiment',
  },
  {
    matches: /^claude-haiku-4-5(?:$|-)/,
    label: 'Claude Haiku 4.5',
    effortLevels: null,
    thinking: 'manual-or-none',
    pricing: HAIKU_PRICING,
    provenance: 'anthropic-models-overview',
  },
  {
    matches: /^claude-sonnet-4-5(?:$|-)|^claude-3(?:$|-)/,
    label: 'legacy Claude model',
    effortLevels: null,
    thinking: 'manual-or-none',
    pricing: SONNET_PRICING,
    provenance: 'anthropic-models-overview',
  },
]);

// Family fallbacks for PRICING ONLY (capability validation never falls back —
// unknown models stay permissive-and-reported instead). Keys point at the
// newest known family member so estimates skew current, and callers are told
// the number is a family estimate rather than an exact published rate.
const PRICING_FAMILY_FALLBACKS = Object.freeze([
  { prefix: 'claude-opus', canonical: 'claude-opus-4-6' },
  { prefix: 'claude-fable', canonical: 'claude-fable-5' },
  { prefix: 'claude-mythos', canonical: 'claude-fable-5' },
  { prefix: 'claude-sonnet', canonical: 'claude-sonnet-4-6' },
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
  if (entry) return { rates: entry.pricing, source: 'catalog', label: entry.label };
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
