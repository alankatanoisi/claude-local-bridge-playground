#!/usr/bin/env node
'use strict';

// R4 repeated-trial evaluation over the planner axis.
//
//   node bin/run-eval.js --mode live --models all --reps 5 \
//     --campaign campaign-2026-08-10-r4 --max-cost-usd 20 [--fault-profile mixed]
//
// Writes per-trial run dirs plus eval-summary.json under eval-runs/<stamp>/.
// Trials run SEQUENTIALLY so per-run cost deltas against the shared durable
// campaign stay clean. --models accepts 'all' or a comma-separated subset of
// the configured planner models.

const fs = require('fs');
const path = require('path');

const { CostBudget } = require('../src/bridge');
const { openCampaignBudget } = require('../src/campaign-budget');
const { loadExperimentConfig } = require('../src/config');
const { aggregate, runRepeatedTrials } = require('../src/evaluation-harness');
const { atomicWrite } = require('../src/ledger');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadExperimentConfig();
  const mode = args.mode || 'mock';
  if (!['mock', 'live'].includes(mode)) throw new Error('--mode must be mock or live');
  const reps = args.reps === undefined ? 5 : Number(args.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > 20) throw new Error('--reps must be 1..20');
  const faultProfile = args.faultProfile || 'mixed';
  if (!['none', 'mixed'].includes(faultProfile)) throw new Error('--fault-profile must be none or mixed');

  const axis = args.axis || 'planner';
  if (!['planner', 'worker'].includes(axis)) throw new Error('--axis must be planner or worker');
  const configured = axis === 'planner' ? config.plannerModels : config.workerModels;
  const models =
    !args.models || args.models === 'all' ? configured : args.models.split(',').map((model) => model.trim());
  for (const model of models) {
    if (!configured.includes(model)) {
      throw new Error(`model is not configured for the ${axis} axis: ${model}`);
    }
  }

  let budget;
  if (mode === 'live') {
    const requestedCap = Number(args.maxCostUsd);
    if (!Number.isFinite(requestedCap) || requestedCap <= 0) {
      throw new Error('live mode requires an explicit positive --max-cost-usd');
    }
    if (requestedCap > config.maxExperimentCostUsd) {
      throw new Error(`requested cap $${requestedCap} exceeds configuration ceiling $${config.maxExperimentCostUsd}`);
    }
    budget = await openCampaignBudget({ campaignId: args.campaign || null, limitUsd: requestedCap });
  } else {
    budget = new CostBudget(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evalRoot = path.join(ROOT, 'eval-runs', stamp);
  const trials = await runRepeatedTrials({
    config,
    models,
    reps,
    mode,
    budget,
    faultProfile,
    traceLevel: args.traceLevel || 'full',
    evalRoot,
    axis,
    plannerModel: args.plannerModel || config.fixedPlannerModel,
    workerModel: args.workerModel || config.fixedWorkerModel,
    onTrialComplete: (trial) => {
      // One progress line per finished trial so long batches are observable.
      process.stderr.write(
        `[eval] ${trial.model} rep ${trial.rep}: ${trial.score.phase}` +
          ` plan_attempts=${trial.score.planAttempts} artifacts=${trial.score.acceptedArtifacts}` +
          ` synth=${trial.score.synthesisState} cost=$${trial.score.costUsd}\n`,
      );
    },
  });

  const summary = {
    mode,
    axis,
    faultProfile,
    reps,
    models,
    fixedPlannerModel: axis === 'worker' ? args.plannerModel || config.fixedPlannerModel : null,
    fixedWorkerModel: axis === 'planner' ? args.workerModel || config.fixedWorkerModel : null,
    campaignId: budget.campaignId || null,
    campaignLimitUsd: budget.campaignId ? budget.limitUsd : null,
    campaignRemainingUsd: budget.campaignId ? budget.remainingUsd : null,
    budgetLedgerPath: budget.ledgerPath || null,
    evalRoot,
    perModel: aggregate(trials),
    trials: trials.map((trial) => ({
      model: trial.model,
      axis: trial.axis,
      plannerModel: trial.plannerModel,
      workerModel: trial.workerModel,
      rep: trial.rep,
      runDir: trial.runDir,
      ...trial.score,
    })),
  };
  atomicWrite(path.join(evalRoot, 'eval-summary.json'), summary);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
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
