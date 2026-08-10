#!/usr/bin/env node
'use strict';

const { loadExperimentConfig } = require('../src/config');
const { runWorkflow } = require('../src/workflow-runner');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadExperimentConfig();
  const mode = args.mode || 'mock';
  const summary = await runWorkflow({
    config,
    workflowName: args.workflow || 'repo_fanout',
    mode,
    plannerModel: args.plannerModel || config.fixedPlannerModel,
    workerModel: args.workerModel || config.fixedWorkerModel,
    faultProfile: args.faultProfile || 'none',
    traceLevel: args.traceLevel || config.traceLevel || 'off',
    maxCostUsd: args.maxCostUsd === undefined ? 0 : Number(args.maxCostUsd),
    campaignId: args.campaign || null,
  });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option.startsWith('--')) throw new Error(`unexpected argument '${option}'`);
    if (index + 1 >= argv.length) throw new Error(`missing value for '${option}'`);
    const key = option
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = argv[++index];
  }
  return args;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
