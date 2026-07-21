'use strict';

/**
 * Drift test for docs/command-builder.html (Roadmap item 2.2a).
 *
 * The builder mirrors three sets of runtime facts in hand-copied constants:
 *   - DEFAULT_TOOL_NAMES (the set of tools visible by default)
 *   - PROMPT_REGISTRY (recommended permissions/tools per template)
 *   - Model list in the model <select>
 *
 * When the runtime changes, this test fails loudly so the builder cannot
 * silently drift out of sync.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// ── Runtime facts (single source of truth) ──

const { TOOLS } = require('../../src/runner/tool-catalog');
const { isToolVisible } = require('../../src/runner/tool-visibility');
const { EFFORT_LEVELS, THINKING_MODES } = require('../../src/runner/model-capabilities');

// P2-01: the no-flag default surface comes straight from the runtime's own
// visibility function (empty ctx = no opt-ins), not a re-implemented filter.
const RUNTIME_DEFAULT_TOOLS = Object.keys(TOOLS).filter((name) => isToolVisible(name, {}));

// ── Helpers: extract facts from the builder HTML ──

function builderPath() {
  return path.join(__dirname, '..', '..', 'docs', 'command-builder.html');
}

function extractJsConstant(html, constName) {
  // Match e.g. "const DEFAULT_TOOL_NAMES = ['a', 'b'];"
  const re = new RegExp('const\\s+' + constName + '\\s*=\\s*\\[([^\\]]*)\\]', 's');
  const m = html.match(re);
  if (!m) return null;
  const inner = m[1];
  const items = [];
  const strRe = /'([^']+)'/g;
  let s;
  while ((s = strRe.exec(inner)) !== null) {
    items.push(s[1]);
  }
  return items;
}

function extractPromptRegistry(html) {
  // Extract PROMPT_REGISTRY as a best-effort JSON-like structure.
  const re = /const\s+PROMPT_REGISTRY\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\};/s;
  const m = html.match(re);
  if (!m) return null;
  const body = m[1];
  const entries = {};
  // Each entry: name: { permissions: '...', tools: '...', params: '...' }
  const entryRe =
    /(\w+):\s*\{\s*permissions:\s*'([^']+)'\s*,\s*tools:\s*'([^']+)'\s*(?:,\s*params:\s*'([^']*)')?\s*\}/g;
  let e;
  while ((e = entryRe.exec(body)) !== null) {
    entries[e[1]] = {
      permissions: e[2],
      tools: e[3],
      params: e[4] || '',
    };
  }
  return entries;
}

const BUILDER_HTML = fs.readFileSync(builderPath(), 'utf-8');

// ── Tests ──

describe('command-builder drift', () => {
  it('DEFAULT_TOOL_NAMES matches runtime default-visible tools', () => {
    const builderTools = extractJsConstant(BUILDER_HTML, 'DEFAULT_TOOL_NAMES');
    assert.ok(builderTools, 'Could not extract DEFAULT_TOOL_NAMES from command-builder.html');
    assert.ok(builderTools.length > 0, 'DEFAULT_TOOL_NAMES is empty — parser broken?');

    const missing = RUNTIME_DEFAULT_TOOLS.filter((t) => !builderTools.includes(t));
    const extra = builderTools.filter((t) => !RUNTIME_DEFAULT_TOOLS.includes(t));

    assert.deepStrictEqual(missing, [], 'Builder is missing runtime default tools — add them to DEFAULT_TOOL_NAMES');
    assert.deepStrictEqual(extra, [], 'Builder has extra tools not in runtime defaults — remove or update runtime');
  });

  it('tool catalog HTML has a checkbox for every known tool', () => {
    const knownToolNames = Object.keys(TOOLS);
    for (const name of knownToolNames) {
      const found = BUILDER_HTML.includes('value="' + name + '"');
      assert.ok(found, 'Tool "' + name + '" missing from HTML tool catalog checkboxes');
    }
  });

  it('PROMPT_REGISTRY entries match known templates', () => {
    const registry = extractPromptRegistry(BUILDER_HTML);
    assert.ok(registry, 'Could not extract PROMPT_REGISTRY from command-builder.html');

    // Every entry must reference real tools and a known permission style.
    const validStyles = new Set(['look-only', 'plan-first', 'edit-ask', 'edit-auto', 'edit-shell']);
    for (const [name, entry] of Object.entries(registry)) {
      const toolNames = entry.tools
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const t of toolNames) {
        assert.ok(TOOLS[t], 'PROMPT_REGISTRY.' + name + ' references unknown tool: ' + t);
      }
      assert.ok(
        validStyles.has(entry.permissions),
        'PROMPT_REGISTRY.' + name + ' has unknown permissions: ' + entry.permissions,
      );
    }
  });

  it('model dropdown includes the runner default model', () => {
    // The runner default model is set in model-pricing.js defaultModelKey.
    // claude-sonnet-4-6 is the canonical default as of this test's creation.
    const defaultModel = 'claude-sonnet-4-6';
    assert.ok(
      BUILDER_HTML.includes('value="' + defaultModel + '"'),
      'Model dropdown missing default model: ' + defaultModel,
    );
  });

  it('model-control dropdowns include every runtime effort and thinking value', () => {
    for (const level of EFFORT_LEVELS) {
      assert.ok(
        BUILDER_HTML.includes('<option value="' + level + '">' + level + '</option>'),
        'Model effort dropdown is missing runtime level: ' + level,
      );
    }

    assert.ok(BUILDER_HTML.includes('<select id="thinking">'), 'Adaptive-thinking dropdown is missing');
    for (const mode of THINKING_MODES) {
      assert.ok(
        BUILDER_HTML.includes('<option value="' + mode + '"'),
        'Adaptive-thinking dropdown is missing runtime mode: ' + mode,
      );
    }
  });

  it('all tools in HTML have a capability group header before them', () => {
    // Every checked tool should belong to one of: Read, Session, Orchestration,
    // Write, Recovery, Advanced write, Shell.
    const knownGroups = ['Read', 'Session', 'Orchestration', 'Write', 'Recovery', 'Advanced write', 'Shell'];
    for (const group of knownGroups) {
      assert.ok(
        BUILDER_HTML.includes('capability-group">' + group + '<'),
        'Missing capability group "' + group + '" in HTML tool catalog',
      );
    }
  });
});
