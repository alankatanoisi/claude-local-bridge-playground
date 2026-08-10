'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { WorkerRegistry } = require('../src/worker-registry');

test('symbolic workers resolve through host-owned provider routes', async () => {
  const calls = [];
  const registry = new WorkerRegistry({
    profiles: {
      repo_file_analyst: {
        route: 'analysis',
        system: 'Analyze one bounded file.',
        maxOutputTokens: 600,
      },
    },
    routes: {
      analysis: { provider: 'fixture_provider', model: 'host-selected-model' },
    },
    providers: {
      fixture_provider: {
        async execute(request) {
          calls.push(request);
          return { text: '{}', usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
        },
      },
    },
  });

  await registry.execute({
    workerName: 'repo_file_analyst',
    prompt: 'Inspect the fixture.',
    maxTokens: 900,
    timeoutMs: 1000,
    label: 'fixture',
  });

  assert.equal(calls[0].model, 'host-selected-model');
  assert.equal(calls[0].maxTokens, 600);
  assert.deepEqual(registry.publicProfiles(), [
    { name: 'repo_file_analyst', description: '', max_output_tokens: 600 },
  ]);
});

test('worker profiles cannot smuggle provider or model authority', () => {
  const base = {
    routes: { analysis: { provider: 'fixture', model: 'host-model' } },
    providers: { fixture: { execute() {} } },
  };
  assert.throws(
    () =>
      new WorkerRegistry({
        ...base,
        profiles: {
          bad: { route: 'analysis', model: 'model-from-profile', system: 'Bad.', maxOutputTokens: 100 },
        },
      }),
    /cannot choose a model or provider/,
  );
});
