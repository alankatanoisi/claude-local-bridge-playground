'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { HINT_CATALOG, formatHint, matchErrorKey } = require('../../src/runner/beginner-hints');

describe('beginner hints', () => {
  it('every catalog entry has whatHappened and tip', () => {
    for (const [key, entry] of Object.entries(HINT_CATALOG)) {
      assert.ok(entry.whatHappened, key + ' missing whatHappened');
      assert.ok(entry.tip, key + ' missing tip');
      assert.ok(!/ENOENT|ECONNREFUSED|403 Forbidden/.test(entry.whatHappened), key + ' leaks jargon in whatHappened');
    }
  });

  it('formatHint renders plain language for workspace trust', () => {
    const hint = formatHint('workspace_not_trusted', { verbose: true });
    assert.match(hint.formatted, /What happened:/);
    assert.match(hint.formatted, /Tip:/);
    assert.match(hint.formatted, /trust-workspace|approved/i);
  });

  it('matchErrorKey maps bridge connection errors', () => {
    assert.equal(matchErrorKey('connect ECONNREFUSED 127.0.0.1:11437'), 'ECONNREFUSED');
    assert.equal(matchErrorKey('Shell commands are disabled'), 'PERMISSION_SHELL_DISABLED');
  });

  it('quiet mode keeps raw message only', () => {
    const hint = formatHint('max_steps', { quiet: true, rawMessage: 'Reached max_steps (4)' });
    assert.equal(hint.formatted, 'Reached max_steps (4)');
  });

  it('explains a local message-contract stop without blaming the bridge', () => {
    const hint = formatHint('message_contract_error');
    assert.match(hint.whatHappened, /tool-call\/result pairing/i);
    assert.match(hint.tip, /fresh session/i);
  });
});
