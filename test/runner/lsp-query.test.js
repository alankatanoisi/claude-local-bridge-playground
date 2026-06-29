'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

const { encodeMessage, createFramer } = require('../../src/runner/lsp/jsonrpc');
const { LspClient } = require('../../src/runner/lsp/lsp-client');
const lspQuery = require('../../src/runner/tools/lsp-query');
const { pickServer } = require('../../src/runner/lsp/lsp-session');

describe('lsp jsonrpc', () => {
  it('frames and parses messages', () => {
    const messages = [];
    const framer = createFramer((msg) => messages.push(msg));
    const payload = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    framer.feed(Buffer.from(encodeMessage(payload), 'utf8'));
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].result, { ok: true });
  });
});

describe('lsp client (mock transport)', () => {
  it('resolves request/response pairs', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const client = new LspClient({ child: { stdin, stdout, kill: () => {} } });

    const promise = client.request('textDocument/hover', { textDocument: { uri: 'file:///x.ts' }, position: { line: 0, character: 0 } });
    stdout.write(
      encodeMessage({
        jsonrpc: '2.0',
        id: 1,
        result: { contents: 'number' },
      }),
    );
    const result = await promise;
    assert.equal(result.contents, 'number');
    client.dispose();
  });
});

describe('lsp_query tool gates', () => {
  it('is disabled without --enable-lsp', async () => {
    const result = await lspQuery.execute({ action: 'definition', path: 'a.ts', line: 1 }, { cwd: '/tmp' });
    assert.equal(result.ok, false);
    assert.ok(result.text.includes('--enable-lsp'));
  });

  it('picks typescript server for .ts files', () => {
    assert.equal(pickServer('src/app.ts').id, 'typescript');
  });
});
