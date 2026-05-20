'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { post } = require('../../src/runner/model-client');

function createMockServer(responseBody, statusCode) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(statusCode, { 'content-type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}/v1/messages` });
    });
  });
}

describe('model-client', () => {
  it('handles 200 text response', async () => {
    const response = {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
    };
    const { server, url } = await createMockServer(response, 200);
    try {
      const result = await post({ model: 'test', max_tokens: 10, messages: [] }, url);
      assert.equal(result.content[0].text, 'Hello world');
    } finally {
      server.close();
    }
  });

  it('handles 400 error', async () => {
    const { server, url } = await createMockServer({ error: 'bad request' }, 400);
    try {
      await assert.rejects(post({ model: 'test', max_tokens: 10, messages: [] }, url), /HTTP 400/);
    } finally {
      server.close();
    }
  });

  it('handles 500 error', async () => {
    const { server, url } = await createMockServer({ error: 'server error' }, 500);
    try {
      await assert.rejects(post({ model: 'test', max_tokens: 10, messages: [] }, url), /HTTP 500/);
    } finally {
      server.close();
    }
  });

  it('handles invalid json', async () => {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('not json');
      });
      server.listen(0, '127.0.0.1', async () => {
        const port = server.address().port;
        try {
          await assert.rejects(
            post({ model: 'test', max_tokens: 10, messages: [] }, `http://127.0.0.1:${port}/v1/messages`),
            /Invalid JSON/,
          );
          resolve();
        } finally {
          server.close();
        }
      });
    });
  });
});
