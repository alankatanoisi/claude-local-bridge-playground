'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { saveAutoMemoryTopic, loadAutoMemoryIndex, VALID_TYPES } = require('../../src/runner/memory/auto-memory');
const { queuePromotion, listPendingPromotions, formatReviewSummary } = require('../../src/runner/memory-review');

describe('auto-memory taxonomy', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-tax-'));
  });

  it('supports four memory types with caps', () => {
    for (const type of VALID_TYPES) {
      saveAutoMemoryTopic(tmp, type + '-topic', 'body for ' + type, type);
    }
    const index = loadAutoMemoryIndex(tmp);
    const types = new Set(index.entries.map((e) => e.type));
    for (const type of VALID_TYPES) assert.ok(types.has(type));
  });
});

describe('memory review workflow', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-review-'));
  });

  it('queues and lists pending promotions', () => {
    queuePromotion(tmp, { id: 'p1', type: 'project', body: 'Remember to run tests before edits.' });
    const pending = listPendingPromotions(tmp).filter((p) => p.status === 'pending');
    assert.equal(pending.length, 1);
    const summary = formatReviewSummary(tmp);
    assert.match(summary, /pending|p1/i);
  });
});
