'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { dropStaleToolResults } = require('../../src/runner/context-compactor');

function read(id, p) {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'read_file', input: { path: p } }],
  };
}
function readResult(id, content) {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content }],
  };
}
function write(id, p) {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'write_file', input: { path: p, content: 'x' } }],
  };
}
function writeResult(id) {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'wrote 1 byte' }],
  };
}
function user(text) {
  return { role: 'user', content: text };
}
function assistant(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

describe('Ext-12 cost-aware compaction', () => {
  it('drops a read result when a later write targets the same path', () => {
    const messages = [
      user('go'),
      read('tu1', 'a.txt'),
      readResult('tu1', 'OLD CONTENT'),
      assistant('done reading'),
      // 18 filler turns to push the read out of the preserve window
      ...Array.from({ length: 9 }, (_, i) => [user('q' + i), assistant('a' + i)]).flat(),
      write('tu2', 'a.txt'),
      writeResult('tu2'),
      user('final'),
    ];
    const out = dropStaleToolResults(messages, 3);
    assert.equal(out.changed, true);
    assert.equal(out.dropped, 1);
    const staleResult = out.messages[2].content[0];
    assert.match(staleResult.content, /compaction:cost-aware/);
    assert.match(staleResult.content, /Stale tool_result/);
  });

  it('does NOT drop a read result that has no later write', () => {
    const messages = [
      user('go'),
      read('tu1', 'a.txt'),
      readResult('tu1', 'content'),
      ...Array.from({ length: 9 }, (_, i) => [user('q' + i), assistant('a' + i)]).flat(),
      user('final'),
    ];
    const out = dropStaleToolResults(messages, 3);
    assert.equal(out.changed, false);
    assert.equal(out.dropped, 0);
  });

  it('preserves reads inside the recent window', () => {
    const messages = [
      user('q'),
      read('tu1', 'a.txt'),
      readResult('tu1', 'content'),
      write('tu2', 'a.txt'),
      writeResult('tu2'),
      user('final'),
    ];
    const out = dropStaleToolResults(messages, 6);
    assert.equal(out.changed, false, 'read is within preserveRecent window');
  });

  it('only matches when the path is the same', () => {
    const messages = [
      user('q'),
      read('tu1', 'a.txt'),
      readResult('tu1', 'a-content'),
      ...Array.from({ length: 9 }, (_, i) => [user('q' + i), assistant('a' + i)]).flat(),
      write('tu2', 'b.txt'),
      writeResult('tu2'),
      user('final'),
    ];
    const out = dropStaleToolResults(messages, 3);
    assert.equal(out.changed, false, 'different path → no invalidation');
  });
});
