'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyCacheControlBudget } = require('../../src/runner/run');

function countCC(blocks) {
  if (!Array.isArray(blocks)) return 0;
  return blocks.filter((b) => b && b.cache_control).length;
}
function countCCInMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    if (Array.isArray(m.content)) n += countCC(m.content);
  }
  return n;
}

describe('applyCacheControlBudget', () => {
  const baseMessages = [
    { role: 'user', content: [{ type: 'text', text: 'first' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    { role: 'user', content: [{ type: 'text', text: 'second' }] },
  ];
  const baseTools = [{ name: 'read_file' }, { name: 'write_file' }];

  it('places three breakpoints without a repoContextBlock', () => {
    const { cachedSystem, cachedTools, cachedMessages } = applyCacheControlBudget(
      'system prompt',
      baseTools,
      baseMessages,
    );
    assert.equal(countCC(cachedSystem), 1, 'one breakpoint on system');
    assert.equal(countCC(cachedTools), 1, 'one breakpoint on tools');
    assert.equal(countCCInMessages(cachedMessages), 1, 'one breakpoint on transcript prefix');
  });

  it('uses the fourth breakpoint when repoContextBlock is provided (E1)', () => {
    const repo = '## Repository context (cached)\n\nsome content';
    const { cachedSystem, cachedTools, cachedMessages } = applyCacheControlBudget(
      'system prompt',
      baseTools,
      baseMessages,
      repo,
    );
    assert.equal(countCC(cachedSystem), 2, 'two breakpoints on system (repo + last block)');
    assert.equal(countCC(cachedTools), 1);
    assert.equal(countCCInMessages(cachedMessages), 1);
    assert.equal(cachedSystem[0].text, repo, 'repo block is first');
    assert.ok(cachedSystem[0].cache_control, 'repo block has cache_control');
  });

  it('works when system is already an array (post-compaction)', () => {
    const sysArray = [
      { type: 'text', text: 'main' },
      { type: 'text', text: 'ghost summary' },
    ];
    const { cachedSystem } = applyCacheControlBudget(sysArray, baseTools, baseMessages, 'repo');
    assert.equal(countCC(cachedSystem), 2);
    assert.equal(cachedSystem[0].text, 'repo');
    assert.equal(cachedSystem[cachedSystem.length - 1].text, 'ghost summary');
  });

  it('never exceeds the Anthropic budget of 4 breakpoints', () => {
    const repo = 'repo';
    const { cachedSystem, cachedTools, cachedMessages } = applyCacheControlBudget('sys', baseTools, baseMessages, repo);
    const total = countCC(cachedSystem) + countCC(cachedTools) + countCCInMessages(cachedMessages);
    assert.ok(total <= 4, 'budget within 4');
  });
});
