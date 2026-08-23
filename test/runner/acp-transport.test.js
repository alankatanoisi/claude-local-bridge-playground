'use strict';

/**
 * acp-transport.test.js — the ACP wire layer: newline framing plus JSON-RPC
 * 2.0 bookkeeping. These are pure in-memory tests; no runner, no model.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

const { encodeLine, createLineFramer } = require('../../src/runner/acp/ndjson');
const { createConnection, RpcError, ERROR_CODES } = require('../../src/runner/acp/connection');

describe('acp ndjson framing', () => {
  it('encodeLine produces exactly one newline-terminated JSON line', () => {
    const line = encodeLine({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.ok(line.endsWith('\n'));
    assert.equal(line.indexOf('\n'), line.length - 1, 'no embedded newlines');
    assert.deepEqual(JSON.parse(line), { jsonrpc: '2.0', id: 1, method: 'initialize' });
  });

  it('reassembles a message split across arbitrary chunk boundaries', () => {
    const seen = [];
    const framer = createLineFramer((msg) => seen.push(msg));
    const wire = encodeLine({ id: 7, result: { ok: true } });
    // Feed byte by byte — the cruelest possible chunking.
    for (const byte of Buffer.from(wire)) framer.feed(Buffer.from([byte]));
    assert.deepEqual(seen, [{ id: 7, result: { ok: true } }]);
  });

  it('splits multiple messages arriving in one chunk', () => {
    const seen = [];
    const framer = createLineFramer((msg) => seen.push(msg));
    framer.feed(encodeLine({ id: 1 }) + encodeLine({ id: 2 }) + encodeLine({ id: 3 }));
    assert.deepEqual(
      seen.map((m) => m.id),
      [1, 2, 3],
    );
  });

  it('drops a malformed line without losing the messages after it', () => {
    const seen = [];
    const framer = createLineFramer((msg) => seen.push(msg));
    framer.feed('this is not json\n' + encodeLine({ id: 9 }));
    assert.deepEqual(seen, [{ id: 9 }]);
  });

  it('tolerates blank lines between messages', () => {
    const seen = [];
    const framer = createLineFramer((msg) => seen.push(msg));
    framer.feed('\n\n' + encodeLine({ id: 4 }) + '\n');
    assert.deepEqual(seen, [{ id: 4 }]);
  });
});

/** Wire two connections back to back through in-memory streams. */
function connectedPair() {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const a = createConnection({ input: bToA, write: (line) => aToB.write(line) });
  const b = createConnection({ input: aToB, write: (line) => bToA.write(line) });
  return { a, b, aToB, bToA };
}

describe('acp jsonrpc connection', () => {
  it('routes a request to its handler and returns the result', async () => {
    const { a, b } = connectedPair();
    b.onMethod('ping', (params) => ({ echoed: params.value }));
    const result = await a.request('ping', { value: 42 });
    assert.deepEqual(result, { echoed: 42 });
  });

  it('answers an unknown request with METHOD_NOT_FOUND instead of hanging', async () => {
    const { a } = connectedPair();
    await assert.rejects(a.request('no/such/method'), (err) => {
      assert.equal(err.code, ERROR_CODES.METHOD_NOT_FOUND);
      return true;
    });
  });

  it('carries a handler-thrown RpcError code and data to the caller', async () => {
    const { a, b } = connectedPair();
    b.onMethod('explode', () => {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'bad input', { hint: 'fix it' });
    });
    await assert.rejects(a.request('explode'), (err) => {
      assert.equal(err.code, ERROR_CODES.INVALID_PARAMS);
      assert.equal(err.message, 'bad input');
      assert.deepEqual(err.data, { hint: 'fix it' });
      return true;
    });
  });

  it('delivers notifications without generating a response', async () => {
    const { a, b, bToA } = connectedPair();
    const seen = [];
    b.onMethod('notice', (params) => seen.push(params));
    const framesToA = [];
    bToA.on('data', (chunk) => framesToA.push(String(chunk)));
    a.notify('notice', { n: 1 });
    // Give the event loop one tick to deliver.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [{ n: 1 }]);
    assert.equal(framesToA.length, 0, 'a notification is never answered');
  });

  it('supports concurrent requests answered out of order', async () => {
    const { a, b } = connectedPair();
    let releaseSlow;
    const slowGate = new Promise((resolve) => (releaseSlow = resolve));
    b.onMethod('slow', async () => {
      await slowGate;
      return { which: 'slow' };
    });
    b.onMethod('fast', () => ({ which: 'fast' }));
    const slowPromise = a.request('slow');
    const fast = await a.request('fast');
    releaseSlow();
    const slow = await slowPromise;
    assert.equal(fast.which, 'fast');
    assert.equal(slow.which, 'slow');
  });

  it('rejects every pending request when the peer closes the stream', async () => {
    const aToB = new PassThrough();
    const bToA = new PassThrough();
    const a = createConnection({ input: bToA, write: (line) => aToB.write(line) });
    const hanging = a.request('never/answered');
    bToA.end();
    await assert.rejects(hanging, /Connection closed/);
  });
});
