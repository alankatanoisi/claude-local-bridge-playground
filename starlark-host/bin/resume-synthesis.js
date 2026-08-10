#!/usr/bin/env node
'use strict';

// Retry only the synthesis stage of a partial run. Workers are never re-run.
//
//   node bin/resume-synthesis.js --run-dir <path> \
//     --campaign <id> --max-cost-usd 2 [--model claude-haiku-4-5] \
//     [--strategy map_reduce|single] [--trace-level full]

const crypto = require('crypto');

const { ClaudeBridge } = require('../src/bridge');
const { openCampaignBudget } = require('../src/campaign-budget');
const { loadExperimentConfig } = require('../src/config');
const { loadRunState, resumeSynthesis } = require('../src/resume-synthesis');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runDir) throw new Error('--run-dir is required');
  const config = loadExperimentConfig();
  const maxCostUsd = Number(args.maxCostUsd);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error('resume is a live operation and requires a positive --max-cost-usd');
  }
  if (maxCostUsd > config.maxExperimentCostUsd) {
    throw new Error(`cost cap $${maxCostUsd} exceeds configured ceiling $${config.maxExperimentCostUsd}`);
  }

  const state = loadRunState(args.runDir);
  const budget = await openCampaignBudget({ campaignId: args.campaign || null, limitUsd: maxCostUsd });
  const traceLevel = args.traceLevel || 'full';
  const traceId = `resume-${crypto.randomUUID()}`;
  const bridge = new ClaudeBridge({
    runnerRepo: config.runnerRepo,
    bridgeUrl: config.bridgeUrl,
    callerToken: process.env.BRIDGE_CALLER_TOKEN,
    budget,
    effort: config.effort,
    traceLevel,
    traceId,
    runId: traceId,
  });

  const summary = await resumeSynthesis({
    runDir: args.runDir,
    bridge,
    model: args.model || state.plannerModel,
    objective: config.objective,
    strategy: args.strategy || 'map_reduce',
    synthesisOptions: config.synthesis || {},
  });

  process.stdout.write(
    JSON.stringify(
      {
        ...summary,
        campaignId: budget.campaignId,
        campaignLimitUsd: budget.limitUsd,
        campaignRemainingUsd: budget.remainingUsd,
        budgetLedgerPath: budget.ledgerPath,
        trace: bridge.traceMetadata(),
      },
      null,
      2,
    ) + '\n',
  );
  if (!summary.ok) process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option.startsWith('--')) throw new Error(`unexpected argument '${option}'`);
    if (index + 1 >= argv.length) throw new Error(`missing value for '${option}'`);
    const key = option.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = argv[++index];
  }
  return args;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
