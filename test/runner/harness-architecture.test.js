'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { STOP_REASONS, normalizeKernelResult, isStopReason } = require('../../src/runner/kernel/contract');

describe('kernel contract', () => {
  it('normalizes success from legacy run result', () => {
    const r = normalizeKernelResult(
      { finalText: 'done', steps: 1, duration_ms: 10, usage: { input_tokens: 1, output_tokens: 2 }, events: [] },
      { exitCode: 0 },
    );
    assert.equal(r.stopReason, STOP_REASONS.SUCCESS);
  });

  it('detects max_steps from final text', () => {
    const r = normalizeKernelResult(
      { finalText: 'Reached max_steps (4) without a final answer.', steps: 4, duration_ms: 1, usage: {}, events: [] },
      { exitCode: 1 },
    );
    assert.equal(r.stopReason, STOP_REASONS.MAX_STEPS);
  });

  it('isStopReason validates known values', () => {
    assert.equal(isStopReason('success'), true);
    assert.equal(isStopReason('nope'), false);
  });
});

describe('session store', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-'));
  const { SessionStore, defaultSession } = require('../../src/runner/session-store');

  it('creates and persists messages', () => {
    const p = path.join(tmp, 'a.state.json');
    const store = new SessionStore(p);
    store.load();
    store.setMessages([{ role: 'user', content: 'hi' }]);
    store.updateRunner({ undoLog: [{ path: 'x' }] });
    store.save();
    const store2 = new SessionStore(p);
    store2.load();
    assert.equal(store2.messages.length, 1);
    assert.equal(store2.data().runner.undoLog.length, 1);
  });

  it('forks session with metadata', () => {
    const p = path.join(tmp, 'b.state.json');
    const forkPath = path.join(tmp, 'b-fork.state.json');
    const store = new SessionStore(p);
    store.load();
    store.updateMetadata({ cwd: '/tmp' });
    store.save();
    const forked = store.fork(forkPath, 3);
    assert.equal(forked.data().metadata.forkedFrom, store.data().sessionId);
    assert.equal(forked.data().metadata.forkTurn, 3);
  });

  it('defaultSession has schema version', () => {
    assert.equal(defaultSession('x').schemaVersion, 1);
  });
});

describe('context compactor', () => {
  const { clipToolResults, applyCompactionLadder, estimateTokens } = require('../../src/runner/context-compactor');

  it('clips long tool results', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: '1', content: 'x'.repeat(5000) }],
      },
    ];
    const { messages: out, changed } = clipToolResults(messages, 1000);
    assert.equal(changed, true);
    assert.ok(out[0].content[0].content.includes('[compaction:clip'));
  });

  it('applyCompactionLadder may inject ghost on long history', () => {
    const messages = [];
    for (let i = 0; i < 45; i++) {
      messages.push({ role: 'user', content: 'msg ' + i });
      messages.push({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] });
    }
    const r = applyCompactionLadder(messages, 'sys', { warnTokens: 10 });
    assert.ok(r.stagesApplied.includes('ghost'));
  });

  it('estimateTokens returns positive for non-empty', () => {
    assert.ok(estimateTokens([{ role: 'user', content: 'hello world' }]) > 0);
  });
});

describe('hooks dispatcher', () => {
  const { HookDispatcher } = require('../../src/runner/hooks/hook-dispatcher');

  it('skips hooks when workspace untrusted', () => {
    const d = new HookDispatcher('/tmp', { trustedWorkspace: false });
    const r = d.dispatch('pre_tool', { tool: 'read_file' });
    assert.equal(r.skipped, true);
  });

  it('runs configured hooks when trusted', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
    fs.mkdirSync(path.join(tmp, '.bridge-runner'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.bridge-runner', 'hooks.json'),
      JSON.stringify({ trusted: true, hooks: [{ event: 'pre_tool', name: 'log' }] }),
      'utf8',
    );
    const d = new HookDispatcher(tmp, { trustedWorkspace: true, workspaceTrusted: true });
    const r = d.dispatch('pre_tool', { tool: 'read_file' });
    assert.equal(r.skipped, false);
    assert.equal(r.results.length, 1);
  });
});

describe('skills index', () => {
  const { buildSkillsIndex } = require('../../src/runner/skills/skills-index');

  it('returns empty listing when no skills dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    const r = buildSkillsIndex(tmp);
    assert.equal(r.entries.length, 0);
  });
});

describe('coordinator synthesizeSpec', () => {
  const { synthesizeSpec } = require('../../src/runner/coordinator');

  it('includes objective and digest', () => {
    const s = synthesizeSpec('fix bug', 'found run.js');
    assert.ok(s.includes('fix bug'));
    assert.ok(s.includes('found run.js'));
  });
});
