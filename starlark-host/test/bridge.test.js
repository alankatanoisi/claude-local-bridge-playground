'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const { ClaudeBridge, CostBudget } = require('../src/bridge');

const RUNNER_REPO = '/Users/alanman/Developer/claude-local-bridge-playground';

test('Claude adapter sends concurrent Messages requests and settles reservations', async (t) => {
  let active = 0;
  let maxActive = 0;
  const bodies = [];
  const server = http.createServer((request, response) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      bodies.push(body);
      setTimeout(() => {
        active -= 1;
        response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': `req_${body.model}` });
        response.end(
          JSON.stringify({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: '{"ok":true}' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 20 },
          }),
        );
      }, 50);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const budget = new CostBudget(1);
  const bridge = new ClaudeBridge({
    runnerRepo: RUNNER_REPO,
    bridgeUrl: `http://127.0.0.1:${server.address().port}/v1/messages`,
    budget,
    effort: 'medium',
  });
  const request = (label) =>
    bridge.call({
      model: 'claude-sonnet-5',
      system: 'Return JSON.',
      prompt: 'Return one small object.',
      maxTokens: 100,
      label,
    });

  const responses = await Promise.all([request('one'), request('two')]);
  assert.equal(maxActive, 2);
  assert.equal(responses[0].text, '{"ok":true}');
  assert.equal(budget.calls.length, 2);
  assert.equal(budget.reservedUsd, 0);
  assert.ok(budget.usedUsd > 0);
  assert.ok(path.isAbsolute(RUNNER_REPO));

  await bridge.call({
    model: 'claude-haiku-4-5',
    system: 'Return JSON.',
    prompt: 'Return one small object.',
    maxTokens: 100,
    label: 'haiku-controls',
  });
  const haikuBody = bodies.find((body) => body.model === 'claude-haiku-4-5');
  assert.equal(haikuBody.output_config, undefined);
  assert.equal(haikuBody.thinking, undefined);
});
