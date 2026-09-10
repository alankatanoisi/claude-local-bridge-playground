'use strict';

/**
 * Ideas 5+6 (research review 2026-08-31, Scroll): searchable lossless history
 * + recoverable clipping.
 *
 *   - _history-index: addressing and deterministic scoring over canonical
 *     messages
 *   - search_history / expand_history tools (opt-in `history` capability
 *     group)
 *   - context-projection recovery hints on clip/stub/emergency markers,
 *     present ONLY when the run offers expand_history
 *   - redaction: recovered history passes the central scrub boundary
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildHistoryIndex, resolveAddress, queryTerms } = require('../../src/runner/tools/_history-index');
const searchHistory = require('../../src/runner/tools/search-history');
const expandHistory = require('../../src/runner/tools/expand-history');
const registry = require('../../src/runner/tool-registry');
const { TOOL_GROUPS, OPTIONAL_CAPABILITIES } = require('../../src/runner/tool-catalog');
const { isToolVisible, normalizeCapabilityList, computeAllowedTools } = require('../../src/runner/tool-visibility');
const { buildContextProjection } = require('../../src/runner/context-projection');
const { deriveContextPolicy } = require('../../src/runner/context-runtime-policy');

function sampleMessages() {
  return [
    { role: 'user', content: 'Find the flaky test in checkout flow' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading the suite first.' },
        { type: 'thinking', thinking: 'secret reasoning NEVER_INDEXED', signature: 'sig' },
        { type: 'tool_use', id: 'tu_read1', name: 'read_file', input: { path: 'checkout.test.js' } },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_read1',
          content: 'describe("checkout") … TIMEOUT_MARKER_9Q4 occurs after retry storm …',
        },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'The timeout comes from the retry storm.' }] },
  ];
}

function ctxFor(messages) {
  return { getCanonicalMessages: () => messages };
}

describe('history index (idea 5 plumbing)', () => {
  it('flattens messages into addressable entries and labels tool_results with their tool', () => {
    const entries = buildHistoryIndex(sampleMessages());
    const kinds = entries.map((entry) => entry.kind);
    assert.deepEqual(kinds, ['user_text', 'assistant_text', 'tool_use', 'tool_result', 'assistant_text']);
    const result = entries.find((entry) => entry.kind === 'tool_result');
    assert.equal(result.address, 'tu_read1');
    assert.equal(result.toolName, 'read_file');
    assert.equal(entries[0].address, 'm0');
    assert.equal(entries[1].address, 'm1.b0');
  });

  it('never indexes thinking blocks', () => {
    const entries = buildHistoryIndex(sampleMessages());
    assert.ok(!entries.some((entry) => entry.text.includes('NEVER_INDEXED')));
  });

  it('resolves addresses: tool_use id prefers the result; m<i> and m<i>.b<j> select structurally', () => {
    const entries = buildHistoryIndex(sampleMessages());
    const byId = resolveAddress(entries, 'tu_read1');
    assert.equal(byId.length, 1);
    assert.equal(byId[0].kind, 'tool_result');
    assert.equal(resolveAddress(entries, 'm1').length, 2); // text + tool_use (thinking excluded)
    assert.equal(resolveAddress(entries, 'm1.b0')[0].kind, 'assistant_text');
    assert.deepEqual(resolveAddress(entries, 'nope'), []);
  });

  it('query terms are lowercased, length-filtered, and bounded', () => {
    assert.deepEqual(queryTerms('Retry STORM x'), ['retry', 'storm']);
    assert.equal(queryTerms(Array(50).fill('word').join(' ')).length, 12);
  });
});

describe('search_history tool', () => {
  it('finds content by keyword and points at expand_history when that tool is offered', () => {
    const ctx = { ...ctxFor(sampleMessages()), enabledCapabilities: normalizeCapabilityList('history') };
    const result = searchHistory.execute({ query: 'TIMEOUT_MARKER_9Q4' }, ctx);
    assert.equal(result.ok, true);
    assert.match(result.text, /id=tu_read1/);
    assert.match(result.text, /tool_result read_file/);
    assert.match(result.text, /expand_history/);
  });

  it('keeps the recover line honest: no expand_history pointer when that tool is not offered', () => {
    // Thermo-nuclear review 2026-09-06, Medium #3: the projection's markers
    // already gate recovery wording on expand_history visibility; the search
    // result must obey the same rule.
    const bare = searchHistory.execute({ query: 'TIMEOUT_MARKER_9Q4' }, ctxFor(sampleMessages()));
    assert.equal(bare.ok, true);
    assert.match(bare.text, /id=tu_read1/, 'hits themselves are unchanged');
    assert.ok(!bare.text.includes('expand_history'), 'must not point at an unoffered tool');
    // The live route: a --tools allowlist that offers search without expand.
    const split = { ...ctxFor(sampleMessages()), _cliToolAllowlist: new Set(['search_history']) };
    split.allowedTools = computeAllowedTools(split);
    const result = searchHistory.execute({ query: 'TIMEOUT_MARKER_9Q4' }, split);
    assert.equal(result.ok, true);
    assert.ok(!result.text.includes('expand_history'), 'split allowlist must not advertise expand_history');
  });

  it('is deterministic: same query, same history, same output', () => {
    const a = searchHistory.execute({ query: 'retry storm' }, ctxFor(sampleMessages()));
    const b = searchHistory.execute({ query: 'retry storm' }, ctxFor(sampleMessages()));
    assert.equal(a.text, b.text);
  });

  it('kind filter narrows hits', () => {
    const result = searchHistory.execute({ query: 'retry', kind: 'text' }, ctxFor(sampleMessages()));
    assert.equal(result.ok, true);
    assert.ok(!result.text.includes('tool_result'));
  });

  it('reports a friendly no-match message and fails without history access', () => {
    const miss = searchHistory.execute({ query: 'zzz_not_present' }, ctxFor(sampleMessages()));
    assert.equal(miss.ok, true);
    assert.match(miss.text, /No history entries match/);
    const noCtx = searchHistory.execute({ query: 'retry' }, {});
    assert.equal(noCtx.ok, false);
  });
});

describe('expand_history tool', () => {
  it('recovers verbatim text by tool_use id with a provenance header', () => {
    const result = expandHistory.execute({ id: 'tu_read1' }, ctxFor(sampleMessages()));
    assert.equal(result.ok, true);
    assert.match(result.text, /^\[history tu_read1 tool_result read_file chars=\d+ span=0\.\.\d+\]/);
    assert.ok(result.text.includes('TIMEOUT_MARKER_9Q4 occurs after retry storm'));
  });

  it('pages large entries and names the next offset', () => {
    const big = sampleMessages();
    big[2].content[0].content = 'A'.repeat(500) + 'MIDDLE' + 'B'.repeat(500);
    const first = expandHistory.execute({ id: 'tu_read1', max_chars: 200 }, ctxFor(big));
    assert.equal(first.ok, true);
    assert.match(first.text, /more chars: call expand_history id=tu_read1 offset=200/);
    const second = expandHistory.execute({ id: 'tu_read1', offset: 200, max_chars: 400 }, ctxFor(big));
    assert.match(second.text, /span=200\.\.600/);
    // The two pages tile without overlap or gaps.
    const firstSlice = first.text.split('\n')[1];
    const secondSlice = second.text.split('\n')[1];
    assert.equal(firstSlice.length, 200);
    assert.equal((firstSlice + secondSlice).slice(495, 511), 'AAAAA' + 'MIDDLE' + 'BBBBB');
  });

  it('expands a whole message with per-block headers', () => {
    const result = expandHistory.execute({ id: 'm1' }, ctxFor(sampleMessages()));
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('[m1.b0 assistant_text]'));
    assert.ok(result.text.includes('[tu_read1 tool_use]'));
  });

  it('fails helpfully on unknown ids and missing history access', () => {
    const miss = expandHistory.execute({ id: 'tu_ghost' }, ctxFor(sampleMessages()));
    assert.equal(miss.ok, false);
    assert.match(miss.text, /search_history/);
    assert.equal(expandHistory.execute({ id: 'tu_read1' }, {}).ok, false);
  });
});

describe('history capability gating', () => {
  it('both tools live in the opt-in history group', () => {
    assert.equal(TOOL_GROUPS.search_history, 'history');
    assert.equal(TOOL_GROUPS.expand_history, 'history');
    assert.ok(OPTIONAL_CAPABILITIES.includes('history'));
  });

  it('hidden by default; visible with --capabilities history', () => {
    const off = { enabledCapabilities: new Set() };
    assert.equal(isToolVisible('search_history', off), false);
    assert.equal(isToolVisible('expand_history', off), false);
    const on = { enabledCapabilities: normalizeCapabilityList('history') };
    assert.equal(isToolVisible('search_history', on), true);
    assert.equal(isToolVisible('expand_history', on), true);
  });
});

describe('redaction boundary over recovered history', () => {
  it('secrets in canonical history are scrubbed on the way out of both tools', async () => {
    const fakeKey = 'sk-ant-api03-' + 'a1b2c3'.repeat(5); // long enough for the real scrub pattern
    const messages = sampleMessages();
    messages[2].content[0].content = 'token ' + fakeKey + ' leaked into an old result';
    const ctx = {
      ...ctxFor(messages),
      cwd: process.cwd(),
      enabledCapabilities: normalizeCapabilityList('history'),
    };
    const expanded = await registry.execute('expand_history', { id: 'tu_read1' }, ctx, 'tu_x1');
    assert.equal(expanded.ok, true);
    assert.ok(!expanded.text.includes(fakeKey), 'expand must not leak the raw token');
    assert.match(expanded.text, /\[REDACTED/);
    const searched = await registry.execute('search_history', { query: 'leaked' }, ctx, 'tu_x2');
    assert.equal(searched.ok, true);
    assert.ok(!searched.text.includes(fakeKey), 'search must not leak the raw token');
  });
});

describe('recoverable clipping markers (idea 6)', () => {
  function exchange(i, text) {
    return [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu' + i, name: 'read_file', input: { path: 'f' + i + '.txt' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu' + i, content: text }] },
    ];
  }

  function project(recovery) {
    const raw = [{ role: 'user', content: 'objective' }];
    for (let i = 0; i < 14; i++) raw.push(...exchange(i, String(i % 10).repeat(30_000)));
    // Checkpoint is pushed out of reach on purpose: checkpointing digests the
    // ORIGINAL messages (clip/stub rewrites are discarded), so marker
    // assertions must exercise the reduction stage alone.
    const policy = {
      ...deriveContextPolicy({ model: 'claude-sonnet-4-6', maxTokens: 2_000, compactAtTokens: 20_000 }),
      checkpoint: 10_000_000,
    };
    return buildContextProjection({
      messages: raw,
      system: [{ type: 'text', text: 'stable system' }],
      tools: [],
      policy,
      calibration: { factor: 1.5, samples: 0, lastObservedTokens: null },
      contextState: null,
      runtime: {},
      recovery,
    });
  }

  it('clip/stub markers name expand_history when recovery is enabled', () => {
    const projected = project({ enabled: true });
    const text = JSON.stringify(projected.messages);
    assert.ok(projected.decision.stages.length > 0, 'fixture must actually trigger reduction');
    assert.match(text, /recover: expand_history id=tu\d+/);
  });

  it('markers stay recovery-free when the history group is not offered', () => {
    const projected = project(undefined);
    const text = JSON.stringify(projected.messages);
    assert.ok(projected.decision.stages.length > 0, 'fixture must actually trigger reduction');
    assert.ok(!text.includes('expand_history'), 'no hint may point at an unoffered tool');
  });

  it('stale-read markers keep the re-read remedy without a recovery hint', () => {
    // A read of f0.txt later overwritten: stale-drop must say re-read, not expand.
    const raw = [{ role: 'user', content: 'objective' }];
    raw.push(...exchange(0, 'old bytes '.repeat(4000)));
    raw.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tuw', name: 'write_file', input: { path: 'f0.txt', content: 'new' } }],
    });
    raw.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tuw', content: 'ok' }] });
    for (let i = 1; i < 14; i++) raw.push(...exchange(i, String(i % 10).repeat(30_000)));
    const policy = {
      ...deriveContextPolicy({ model: 'claude-sonnet-4-6', maxTokens: 2_000, compactAtTokens: 20_000 }),
      checkpoint: 10_000_000, // keep the reduction stage's markers in the output (see above)
    };
    const projected = buildContextProjection({
      messages: raw,
      system: [{ type: 'text', text: 'stable system' }],
      tools: [],
      policy,
      calibration: { factor: 1.5, samples: 0, lastObservedTokens: null },
      contextState: null,
      runtime: {},
      recovery: { enabled: true },
    });
    const staleBlocks = [];
    for (const message of projected.messages) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type === 'tool_result' && String(block.content).includes('[context:stale-read]')) {
          staleBlocks.push(String(block.content));
        }
      }
    }
    assert.ok(staleBlocks.length > 0, 'fixture must trigger a stale-read drop');
    for (const text of staleBlocks) {
      assert.ok(!text.includes('expand_history'), 'stale evidence must say re-read, never recover');
    }
  });
});
