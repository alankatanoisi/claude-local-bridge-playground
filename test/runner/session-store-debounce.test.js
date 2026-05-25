'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function freshStore(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sessstore-debounce-' + label + '-'));
  const sessionPath = path.join(tmp, 'a.state.json');
  delete require.cache[require.resolve('../../src/runner/session-store')];
  const { SessionStore } = require('../../src/runner/session-store');
  const store = new SessionStore(sessionPath);
  store.load();
  return { store, sessionPath, tmp };
}

describe('SessionStore debouncer', () => {
  it('coalesces many saveSoon() calls into one write', async () => {
    const { store, sessionPath } = freshStore('coalesce');
    store._debounceMs = 30;
    let writes = 0;
    const realWrite = fs.writeFileSync;
    fs.writeFileSync = function (p, data, opts) {
      if (typeof p === 'string' && p.startsWith(sessionPath + '.tmp')) writes++;
      return realWrite.call(fs, p, data, opts);
    };
    try {
      for (let i = 0; i < 10; i++) {
        store.appendMessage({ role: 'user', content: 'hi-' + i });
        store.saveSoon();
      }
      assert.equal(writes, 0, 'no write before timer fires');
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(writes, 1, 'exactly one flush after debounce window');
    } finally {
      fs.writeFileSync = realWrite;
      store.dispose();
    }
  });

  it('flushSync() writes immediately and cancels the pending timer', () => {
    const { store, sessionPath } = freshStore('flush');
    store._debounceMs = 5000;
    store.appendMessage({ role: 'user', content: 'x' });
    store.saveSoon();
    assert.equal(fs.existsSync(sessionPath), false);
    store.flushSync();
    assert.equal(fs.existsSync(sessionPath), true);
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.equal(data.messages.length, 1);
    assert.equal(data.messages[0].content, 'x');
    assert.equal(store._timer, null, 'timer cleared after flushSync');
  });

  it('debounceMs=0 makes saveSoon synchronous', () => {
    const { store, sessionPath } = freshStore('zero');
    store._debounceMs = 0;
    store.appendMessage({ role: 'user', content: 'sync-write' });
    store.saveSoon();
    assert.equal(fs.existsSync(sessionPath), true, 'wrote synchronously');
    store.dispose();
  });

  it('flushSync() is a no-op when not dirty', () => {
    const { store, sessionPath } = freshStore('clean');
    store.appendMessage({ role: 'user', content: 'first' });
    store.save();
    const mtime1 = fs.statSync(sessionPath).mtimeMs;
    store.flushSync();
    const mtime2 = fs.statSync(sessionPath).mtimeMs;
    assert.equal(mtime1, mtime2, 'no rewrite when clean');
    store.dispose();
  });
});
