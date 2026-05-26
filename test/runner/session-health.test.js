'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { STOP_REASONS } = require('../../src/runner/kernel/contract');
const { SessionStore } = require('../../src/runner/session-store');
const health = require('../../src/runner/session-health');

describe('session health', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-health-'));

  it('marks degraded stop reasons', () => {
    const h = health.buildHealth({ stopReason: STOP_REASONS.MAX_STEPS, compactionGeneration: 0 });
    assert.equal(h.degraded, true);
    assert.ok(h.reasons.includes(STOP_REASONS.MAX_STEPS));
    assert.equal(h.recommendation, health.RECOMMENDATIONS.FRESH_SESSION);
  });

  it('marks success as resume_ok', () => {
    const h = health.buildHealth({ stopReason: STOP_REASONS.SUCCESS, compactionGeneration: 1 });
    assert.equal(h.degraded, false);
    assert.equal(h.recommendation, health.RECOMMENDATIONS.RESUME_OK);
  });

  it('degrades on high compaction generation', () => {
    const h = health.buildHealth({
      stopReason: STOP_REASONS.SUCCESS,
      compactionGeneration: health.MAX_COMPACTION_GENERATION,
    });
    assert.equal(h.degraded, true);
    assert.ok(h.reasons.includes('compaction_generation_high'));
  });

  it('blocks resume when degraded without ack', () => {
    const p = path.join(tmp, 'degraded.state.json');
    const store = new SessionStore(p);
    store.load();
    store.updateRunner({
      health: health.buildHealth({ stopReason: STOP_REASONS.SEMANTIC_CYCLE_DETECTED }),
    });
    store.save();

    const check = health.assertResumeAllowed(store, { ackResumeRisk: false });
    assert.equal(check.allowed, false);
    assert.match(check.message, /--new-session/);
  });

  it('allows resume when ack flag is set', () => {
    const p = path.join(tmp, 'degraded-ack.state.json');
    const store = new SessionStore(p);
    store.load();
    store.updateRunner({
      health: health.buildHealth({ stopReason: STOP_REASONS.BRIDGE_ERROR }),
    });
    store.save();

    const check = health.assertResumeAllowed(store, { ackResumeRisk: true });
    assert.equal(check.allowed, true);
    assert.equal(check.acknowledged, true);
  });
});
