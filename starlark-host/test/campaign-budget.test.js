'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const { ClaudeBridge } = require('../src/bridge');
const { openCampaignBudget } = require('../src/campaign-budget');

const RUNNER_REPO = path.resolve(__dirname, '../..');
const pricing = require(path.join(RUNNER_REPO, 'src/runner/model-pricing.js'));

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-budget-'));
}

test('spend survives the process: a second instance sees prior settle', async () => {
  const dir = tempRoot();
  const first = await openCampaignBudget({ campaignId: 'durability', limitUsd: 1, dir });
  const reservation = await first.reserve(0.5, 'call-one');
  await first.settle(reservation, { label: 'call-one', costUsd: 0.25 });

  // A fresh instance simulates a separate command joining the campaign.
  const second = await openCampaignBudget({ campaignId: 'durability', dir });
  assert.equal(second.limitUsd, 1);
  assert.equal(second.usedUsd, 0.25);
  assert.equal(second.reservedUsd, 0);
  assert.equal(second.remainingUsd, 0.75);
  await assert.rejects(second.reserve(0.8, 'over'), /cost gate blocked/);
  await second.reserve(0.7, 'fits');
});

test('a campaign cap can never be changed by rejoining with a different number', async () => {
  const dir = tempRoot();
  await openCampaignBudget({ campaignId: 'fixed-cap', limitUsd: 2, dir });
  await assert.rejects(
    openCampaignBudget({ campaignId: 'fixed-cap', limitUsd: 5, dir }),
    /caps never change silently/,
  );
});

test('concurrent reservations in one process cannot overbook the cap', async () => {
  const dir = tempRoot();
  const budget = await openCampaignBudget({ campaignId: 'overbook', limitUsd: 1, dir });
  const first = await budget.reserve(0.6, 'first');
  await assert.rejects(budget.reserve(0.6, 'second'), /cost gate blocked/);
  await budget.release(first);
  await budget.reserve(0.6, 'second-after-release');
});

test('two separate processes reserving concurrently: exactly one wins', async () => {
  const dir = tempRoot();
  await openCampaignBudget({ campaignId: 'race', limitUsd: 1, dir });

  // Each child joins the existing campaign and attempts to reserve more than
  // half the cap. Whatever the interleaving, the durable ledger must admit at
  // most one of them.
  const childScript = `
    const { openCampaignBudget } = require(process.argv[1]);
    openCampaignBudget({ campaignId: 'race', dir: process.argv[2] })
      .then((budget) => budget.reserve(0.6, 'child-' + process.pid))
      .then(() => process.stdout.write('RESERVED'))
      .catch(() => process.stdout.write('BLOCKED'));
  `;
  const modulePath = path.join(__dirname, '..', 'src', 'campaign-budget.js');
  const run = () =>
    execFileAsync(process.execPath, ['-e', childScript, modulePath, dir]).then((r) => r.stdout);
  const [a, b] = await Promise.all([run(), run()]);
  const outcomes = [a, b].sort();
  assert.deepEqual(outcomes, ['BLOCKED', 'RESERVED'], `unexpected outcomes: ${a}, ${b}`);
});

test('a reservation from a crashed process is swept, with the correction on the ledger', async () => {
  const dir = tempRoot();
  const budget = await openCampaignBudget({ campaignId: 'stale', limitUsd: 1, dir });

  // Obtain a PID that is certainly dead: a child that already exited.
  const { stdout } = await execFileAsync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  const deadPid = Number(stdout);

  // Simulate the crash by appending the dead process's reservation directly —
  // exactly what the ledger would hold if that process died mid-call.
  const ledgerPath = path.join(dir, 'stale', 'budget.ledger.jsonl');
  fs.appendFileSync(
    ledgerPath,
    JSON.stringify({ v: 1, seq: 2, ts: new Date().toISOString(), pid: deadPid, type: 'reserve', reservationId: 'res_dead', estimatedUsd: 0.9, label: 'crashed' }) + '\n',
  );

  // Without the sweep this reserve would be blocked (0.9 + 0.6 > 1).
  await budget.reserve(0.6, 'after-crash');
  const events = fs
    .readFileSync(ledgerPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const sweep = events.find((event) => event.type === 'release' && event.reason === 'stale_pid');
  assert.ok(sweep, 'expected an explicit stale_pid release record');
  assert.equal(sweep.reservationId, 'res_dead');
});

test('R2 regression: a cache-heavy reconciliation moves the remaining budget', async () => {
  const dir = tempRoot();
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_input_tokens: 800000,
    cache_creation_input_tokens: 300000,
  };
  const model = 'claude-haiku-4-5';

  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage,
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const budget = await openCampaignBudget({ campaignId: 'cache-heavy', limitUsd: 1, dir });
    const bridge = new ClaudeBridge({
      runnerRepo: RUNNER_REPO,
      bridgeUrl: `http://127.0.0.1:${server.address().port}/v1/messages`,
      budget,
      effort: 'medium',
    });
    await bridge.call({ model, system: 'fixture', prompt: 'fixture', maxTokens: 16, label: 'cache-heavy' });

    const expected = pricing.estimateCostUsd(model, usage);
    const inputOutputOnly = pricing.estimateCostUsd(model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    });
    // The cache components must be a real, visible part of the charge…
    assert.ok(expected > inputOutputOnly, 'cache tokens must increase the estimated cost');
    // …and the durable balance must move by the full cache-aware amount.
    assert.ok(Math.abs(budget.usedUsd - expected) < 1e-9, `usedUsd ${budget.usedUsd} != ${expected}`);

    // Durability of the same settlement: a rejoining command sees it too.
    const rejoined = await openCampaignBudget({ campaignId: 'cache-heavy', dir });
    assert.ok(Math.abs(rejoined.usedUsd - expected) < 1e-9);
    assert.ok(Math.abs(rejoined.remainingUsd - (1 - expected)) < 1e-9);
  } finally {
    server.close();
  }
});
