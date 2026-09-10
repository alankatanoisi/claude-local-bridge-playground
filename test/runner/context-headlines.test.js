'use strict';

/**
 * Idea 7 (research review 2026-08-31, Scroll): headlines + the "what you've
 * forgotten" index. search_history recovers what the model asks about; this
 * index keeps it aware of exchanges the projection hid entirely.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHeadlines,
  selectHiddenHeadlines,
  renderHeadlineIndex,
  MAX_INDEX_LINES,
} = require('../../src/runner/context-headlines');
const { buildContextProjection } = require('../../src/runner/context-projection');
const { deriveContextPolicy } = require('../../src/runner/context-runtime-policy');

function exchange(i, text, options = {}) {
  const assistantContent = [];
  if (options.say !== null) {
    assistantContent.push({ type: 'text', text: options.say || 'Reading file ' + i + ' to check the retry logic.' });
  }
  assistantContent.push({ type: 'tool_use', id: 'tu' + i, name: 'read_file', input: { path: 'f' + i + '.txt' } });
  return [
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu' + i, content: text }] },
  ];
}

function bigHistory(count) {
  const raw = [{ role: 'user', content: 'objective: find the flaky checkout test' }];
  for (let i = 0; i < count; i++) raw.push(...exchange(i, String(i % 10).repeat(30_000)));
  return raw;
}

function policyWith(overrides) {
  return {
    ...deriveContextPolicy({ model: 'claude-sonnet-4-6', maxTokens: 2_000, compactAtTokens: 20_000 }),
    ...overrides,
  };
}

function project(raw, { policy, recovery, headlines } = {}) {
  return buildContextProjection({
    messages: raw,
    system: [{ type: 'text', text: 'stable system' }],
    tools: [],
    policy: policy || policyWith({ checkpoint: 10_000_000 }),
    calibration: { factor: 1.5, samples: 0, lastObservedTokens: null },
    contextState: null,
    runtime: {},
    recovery,
    headlines,
  });
}

describe('headline building', () => {
  it("harvests the assistant's own first sentence as a model-written headline, bound to addresses", () => {
    const raw = [{ role: 'user', content: 'objective' }, ...exchange(0, 'x'.repeat(2_500))];
    const headlines = buildHeadlines(raw);
    // The leading user prompt is absorbed into the exchange that answers it
    // (groupSemanticExchanges), so prompt + turn + result is ONE headline m0–m2.
    assert.equal(headlines.length, 1);
    const turn = headlines[0];
    assert.equal(turn.source, 'assistant');
    assert.equal(turn.headline, 'Reading file 0 to check the retry logic.');
    assert.equal(turn.seq, 0);
    assert.equal(turn.end, 3);
    assert.deepEqual(turn.toolUseIds, ['tu0']);
    assert.match(turn.toolSummary, /read_file f0\.txt → 2\.5k chars/);
  });

  it('falls back to a host-derived tool summary for tool-only turns and flags errors', () => {
    const raw = [{ role: 'user', content: 'objective' }, ...exchange(0, 'boom', { say: null })];
    raw[2].content[0].is_error = true;
    const turn = buildHeadlines(raw)[0];
    assert.equal(turn.source, 'tools');
    assert.match(turn.headline, /read_file f0\.txt → 4 chars ERROR/);
  });

  it('caps headline length to one line', () => {
    const raw = [{ role: 'user', content: 'objective' }, ...exchange(0, 'x', { say: 'word '.repeat(100) })];
    const turn = buildHeadlines(raw)[0];
    assert.ok(turn.headline.length <= 120);
    assert.ok(!turn.headline.includes('\n'));
  });
});

describe('hidden selection and roll-up rendering', () => {
  it('selects exchanges behind the checkpoint cutoff or with hidden tool results — not clipped ones', () => {
    const raw = bigHistory(6);
    const headlines = buildHeadlines(raw);
    // Exchanges: (prompt m0 + m1-m2), then pairs (m3-m4), (m5-m6), …; cutoff 5 hides the first two.
    const byCutoff = selectHiddenHeadlines(headlines, { rawCutoff: 5 });
    assert.deepEqual(
      byCutoff.map((entry) => entry.seq),
      [0, 3],
    );
    const byStub = selectHiddenHeadlines(headlines, { hiddenToolUseIds: new Set(['tu4']) });
    assert.deepEqual(
      byStub.map((entry) => entry.seq),
      [9],
    );
  });

  it('renders one line per hidden exchange with recovery wording only when enabled', () => {
    const hidden = selectHiddenHeadlines(buildHeadlines(bigHistory(3)), { rawCutoff: 7 });
    const withRecovery = renderHeadlineIndex(hidden, { recoveryEnabled: true });
    assert.match(withRecovery.text, /^\[context:headline-index v1\] 3 earlier exchange/);
    assert.match(withRecovery.text, /expand_history/);
    assert.match(
      withRecovery.text,
      /- m0–m2 \| Reading file 0 to check the retry logic\. \| read_file f0\.txt → 30k chars \| ids: tu0/,
    );
    const without = renderHeadlineIndex(hidden, { recoveryEnabled: false });
    assert.ok(!without.text.includes('expand_history'), 'must not point at an unoffered tool');
    assert.match(without.text, /re-run a tool/);
  });

  it('rolls the oldest exchanges into one range line past the cap', () => {
    const count = MAX_INDEX_LINES + 15;
    const hidden = selectHiddenHeadlines(buildHeadlines(bigHistory(count)), { rawCutoff: 1 + count * 2 });
    const rendered = renderHeadlineIndex(hidden, { recoveryEnabled: true });
    assert.equal(rendered.entries, count);
    assert.equal(rendered.rolledUp, count - MAX_INDEX_LINES);
    assert.match(rendered.text, /older exchange\(s\), rolled up \| tools: read_file×\d+/);
    const lineCount = rendered.text.split('\n').length;
    assert.ok(lineCount <= MAX_INDEX_LINES + 2, 'header + roll-up line + capped entries');
  });

  it('renders nothing when nothing is hidden', () => {
    assert.deepEqual(renderHeadlineIndex([], {}), { text: '', entries: 0, rolledUp: 0 });
  });
});

describe('projection integration', () => {
  it('appends the index when old results are stubbed, keyed to the hidden ids, and never mutates canonical history', () => {
    const raw = bigHistory(14);
    const snapshot = JSON.stringify(raw);
    const projected = project(raw, { recovery: { enabled: true } });
    assert.equal(JSON.stringify(raw), snapshot, 'canonical history untouched');
    assert.ok(projected.decision.stages.includes('stub_old_results'), 'fixture must stub old results');
    assert.ok(projected.decision.stages.includes('headline_index'));
    assert.ok(projected.decision.headlineIndexEntries > 0);
    const text = JSON.stringify(projected.messages);
    assert.match(text, /\[context:headline-index v1\]/);
    assert.match(text, /ids: tu0/);
    // The index rides the LAST user message (tail), not the cache-stable prefix.
    const last = projected.messages[projected.messages.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(JSON.stringify(last.content).includes('headline-index'));
  });

  it('lists exchanges digested behind a checkpoint', () => {
    const raw = bigHistory(14);
    const projected = project(raw, { policy: policyWith({ checkpoint: 35_000 }), recovery: { enabled: true } });
    assert.ok(projected.decision.checkpointRawCutoff > 0, 'fixture must checkpoint');
    assert.ok(projected.decision.stages.includes('headline_index'));
    assert.ok(projected.decision.headlineIndexEntries >= 1);
    const text = JSON.stringify(projected.messages);
    assert.match(text, /headline-index v1\] \d+ earlier exchange/);
  });

  it('is absent when nothing was hidden, and can be disabled explicitly', () => {
    const small = [{ role: 'user', content: 'hi' }, ...exchange(0, 'tiny')];
    const quiet = project(small);
    assert.ok(!quiet.decision.stages.includes('headline_index'));
    assert.equal(quiet.decision.headlineIndexEntries, 0);
    const disabled = project(bigHistory(14), { headlines: false });
    assert.ok(disabled.decision.stages.includes('stub_old_results'));
    assert.ok(!disabled.decision.stages.includes('headline_index'));
  });

  it('keeps the recovery pointer honest: no expand_history mention unless recovery is enabled', () => {
    const projected = project(bigHistory(14), { recovery: undefined });
    assert.ok(projected.decision.stages.includes('headline_index'));
    assert.ok(!JSON.stringify(projected.messages).includes('expand_history'));
  });
});

// Thermo-nuclear review 2026-09-06 (context layer), Medium #1 and #2: the
// hidden set must be measured on the request actually sent, and the index must
// never turn a fitting request into a hard stop.
describe('hidden-set honesty and ceiling safety', () => {
  function headlineIndexText(messages) {
    for (const message of messages) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type === 'text' && String(block.text).startsWith('[context:headline-index')) return block.text;
      }
    }
    return '';
  }

  function verbatimResultIds(messages, length) {
    const ids = new Set();
    for (const message of messages) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type !== 'tool_result' || typeof block.content !== 'string') continue;
        if (block.content.includes('[context:')) continue; // marker, stub, or clip — not verbatim
        if (length === undefined || block.content.length === length) ids.add(block.tool_use_id);
      }
    }
    return ids;
  }

  it('does not list results a partial checkpoint restored verbatim (Medium #1)', () => {
    // Geometry that forces the checkpoint loop to stop early: one huge first
    // exchange (digesting it collapses the estimate below compact), mid-size
    // exchanges the reduction pass stubs, and a protected tail that keeps
    // post-reduction occupancy above the checkpoint threshold. The checkpoint
    // then rebuilds its tail from the ORIGINAL messages, restoring tu3/tu4
    // verbatim even though reduction had stubbed them.
    const raw = [{ role: 'user', content: 'objective' }];
    raw.push(...exchange(0, 'x'.repeat(300_000)));
    for (let i = 1; i <= 4; i++) raw.push(...exchange(i, String(i).repeat(8_000)));
    for (let i = 5; i <= 6; i++) raw.push(...exchange(i, String(i).repeat(30_000)));
    const projected = project(raw, {
      policy: policyWith({ compact: 30_000, checkpoint: 20_000, protectedExchanges: 2 }),
      recovery: { enabled: true },
    });
    assert.equal(projected.stopReason, undefined);
    assert.ok(projected.decision.oldResultsStubbed > 0, 'fixture must stub old results');
    assert.ok(projected.decision.checkpointRawCutoff > 0, 'fixture must checkpoint');
    const restored = verbatimResultIds(projected.messages, 8_000);
    assert.ok(restored.size > 0, 'fixture must restore a previously stubbed result behind a partial checkpoint');
    const index = headlineIndexText(projected.messages);
    assert.ok(index, 'digested exchanges must still be indexed');
    assert.match(index, /ids: tu0/, 'a digested exchange stays in the index');
    for (const id of restored) {
      assert.ok(!index.includes(id), 'index must not list ' + id + ' — its result is back verbatim in the tail');
    }
  });

  it('never lists an id whose result is verbatim in the projected request (14×30k geometry)', () => {
    const projected = project(bigHistory(14), {
      policy: policyWith({ checkpoint: 35_000 }),
      recovery: { enabled: true },
    });
    const index = headlineIndexText(projected.messages);
    assert.ok(index, 'fixture must produce an index');
    const listed = [...index.matchAll(/tu\d+/g)].map((match) => match[0]);
    assert.ok(listed.length > 0);
    const verbatim = verbatimResultIds(projected.messages);
    for (const id of listed) {
      assert.ok(!verbatim.has(id), 'index lists ' + id + ' but its full result is visible in the request');
    }
  });

  it('drops the index instead of tripping the ceiling when the request barely fits (Medium #2)', () => {
    const raw = bigHistory(14);
    // Measure the exact post-projection occupancy without the index, then set
    // the ceiling just above it: the request fits, the index would not.
    const probe = project(raw, { headlines: false, recovery: { enabled: true } });
    assert.equal(probe.stopReason, undefined);
    const tight = policyWith({
      checkpoint: 10_000_000,
      inputCeiling: probe.decision.afterCalibratedTokens + 60,
    });
    const projected = project(raw, { policy: tight, recovery: { enabled: true } });
    assert.equal(projected.stopReason, undefined, 'the index must be dropped, never turned into a hard stop');
    assert.ok(projected.decision.stages.includes('headline_index_dropped'));
    assert.ok(!projected.decision.stages.includes('headline_index'));
    assert.equal(projected.decision.headlineIndexDropped, true);
    assert.equal(projected.decision.headlineIndexEntries, 0);
    assert.ok(!JSON.stringify(projected.messages).includes('headline-index'));
  });
});
