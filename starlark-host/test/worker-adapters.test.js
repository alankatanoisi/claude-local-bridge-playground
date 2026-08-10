'use strict';

/**
 * R9 contract tests: the provider seam, proven with two real adapters.
 *
 * Until now "provider-neutral" meant "the code is shaped so a second provider
 * could exist." These tests make it an observed property: the same symbolic
 * worker, the same job descriptors, and the same coordinator pipeline run
 * against BOTH the bridge adapter and the deterministic analyst, and the only
 * thing that changes is who does the analysis.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CostBudget } = require('../src/bridge');
const { parseWorkerOutput } = require('../src/coordinator');
const { analyzeDocument, createDeterministicProvider, extractDocuments } = require('../src/deterministic-analyst');
const { WorkerRegistry } = require('../src/worker-registry');
const { runWorkflow } = require('../src/workflow-runner');
const { loadExperimentConfig } = require('../src/config');

const PROFILES = {
  repo_file_analyst: {
    route: 'analysis',
    description: 'test profile',
    maxOutputTokens: 1800,
    system: 'Return strict JSON.',
  },
};

function fixturePrompt() {
  return (
    'OBJECTIVE:\nProfile the file.\n\nASSIGNED TASK:\nAnalyze the supplied file.\n\n' +
    'DOCUMENT doc1 (src/example.js, sha256 abc123def456abc1):\n' +
    "const x = require('y');\nfunction main() {\n  // TODO: tighten\n  return x;\n}\n"
  );
}

test('both providers satisfy the same execute() contract for the same request', async () => {
  const request = {
    workerName: 'repo_file_analyst',
    prompt: fixturePrompt(),
    maxTokens: 900,
    timeoutMs: 30000,
    label: 'worker:contract:attempt:1',
  };

  const bridgeCalls = [];
  const fakeBridge = {
    call: async (r) => {
      bridgeCalls.push(r);
      return {
        text: JSON.stringify({ summary: 'model says ok', claims: [], evidence: [], confidence: 0.7 }),
        usage: { input_tokens: 10, output_tokens: 5 },
        costUsd: 0.001,
        rawStopReason: 'end_turn',
      };
    },
  };

  const registryFor = (provider, providers) =>
    new WorkerRegistry({
      profiles: PROFILES,
      routes: { analysis: { provider, model: 'test-model' } },
      providers,
    });

  const viaBridge = await registryFor('local_claude_bridge', {
    local_claude_bridge: { execute: (r) => fakeBridge.call(r) },
  }).execute(request);
  const viaDeterministic = await registryFor('deterministic_analyst', {
    deterministic_analyst: createDeterministicProvider(),
  }).execute(request);

  // Same envelope contract from both providers…
  for (const response of [viaBridge, viaDeterministic]) {
    assert.equal(typeof response.text, 'string');
    assert.equal(typeof response.costUsd, 'number');
    assert.equal(response.rawStopReason, 'end_turn');
    // …and both texts survive the coordinator's strict worker-output parser.
    const output = parseWorkerOutput(response.text);
    assert.ok(output.summary.length > 0);
    assert.ok(output.confidence >= 0 && output.confidence <= 1);
  }
  // The registry clamped and routed identically: model chosen by the route,
  // never by the descriptor.
  assert.equal(bridgeCalls[0].model, 'test-model');
  assert.equal(bridgeCalls[0].maxTokens, 900);
});

test('deterministic provider is byte-for-byte reproducible and costs nothing', async () => {
  const provider = createDeterministicProvider();
  const request = { prompt: fixturePrompt(), label: 'worker:repro' };
  const first = await provider.execute(request);
  const second = await provider.execute(request);
  assert.equal(first.text, second.text);
  assert.equal(first.requestFingerprint, second.requestFingerprint);
  assert.equal(first.costUsd, 0);

  const analysis = analyzeDocument(extractDocuments(fixturePrompt())[0]);
  // 5 code lines + the trailing-newline empty entry = 6 split segments.
  assert.match(analysis.summary, /6 lines/);
  assert.match(analysis.claims[1], /1 required modules/);
  assert.match(analysis.claims[2], /1 TODO\/FIXME/);
});

test('the full repo_fanout workflow completes on the deterministic provider at $0', async () => {
  // Mock planner (MockBridge) + deterministic workers: a complete pipeline
  // run with zero model calls of any kind.
  const config = loadExperimentConfig();
  const summary = await runWorkflow({
    config,
    workflowName: 'repo_fanout',
    mode: 'mock',
    faultProfile: 'none',
    workerProvider: 'deterministic_analyst',
    runRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'det-workflow-')),
  });
  assert.equal(summary.phase, 'completed');
  assert.equal(summary.inputs, 6);
  assert.equal(summary.successes, 6);
  assert.equal(summary.failures, 0);
  assert.equal(summary.estimatedCostUsd, 0);
});

test('a route naming an unregistered provider fails closed at construction', () => {
  assert.throws(
    () =>
      new WorkerRegistry({
        profiles: PROFILES,
        routes: { analysis: { provider: 'ghost_provider', model: 'x' } },
        providers: { local_claude_bridge: { execute: async () => ({}) } },
      }),
    /unknown provider/,
  );
});
