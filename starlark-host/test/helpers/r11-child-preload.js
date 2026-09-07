'use strict';

// This preload is ONLY used by tests. It slows the real deterministic adapter
// without exposing timing or fault-injection flags in the user's CLI.
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const fixture = JSON.parse(fs.readFileSync(process.env.R11_FIXTURE, 'utf8'));
const configModule = require('../../src/config');
configModule.loadExperimentConfig = () => fixture.config;

const bridgeModule = require('../../src/bridge');
const OriginalBudget = bridgeModule.CostBudget;
bridgeModule.CostBudget = class extends OriginalBudget {
  constructor(limit) {
    super(limit);
    this.save();
  }
  save() {
    const { atomicWrite } = require('../../src/ledger');
    atomicWrite(path.join(fixture.root, 'budget.json'), this.toJSON());
  }
  record(entry) {
    super.record(entry);
    this.save();
  }
};

const adapter = require('../../src/deterministic-analyst');
const create = adapter.createDeterministicProvider;
let execution = 0;
adapter.createDeterministicProvider = () => {
  const real = create();
  return {
    async execute(request) {
      execution += 1;
      // A separate receipt per actual invocation exposes otherwise invisible
      // re-execution of a deterministic job whose output bytes are identical.
      const dir = path.join(fixture.root, 'executions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${process.pid}-${execution}.json`), JSON.stringify({ label: request.label }));
      if (execution === 4 && process.send) process.send({ ready: true });
      await delay(process.env.R11_FAST ? 1 : execution === 1 ? 20 : 10000, undefined, { signal: request.signal });
      return real.execute(request);
    },
  };
};

const workflow = require('../../src/workflow-runner');
const run = workflow.runWorkflow;
workflow.runWorkflow = (options) => run({ ...options, runRoot: path.join(fixture.root, 'runs') });
