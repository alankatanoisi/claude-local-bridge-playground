#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ClaudeBridge, CostBudget, MockBridge } = require('../src/bridge');
const { loadExperimentConfig } = require('../src/config');
const { PhasedCoordinator } = require('../src/coordinator');

const ROOT = path.resolve(__dirname, '..');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadExperimentConfig();
  const mode = args.mode || 'mock';
  const axis = args.axis || 'planner';
  const faultProfile = args.faultProfile || 'mixed';
  const traceLevel = args.traceLevel || config.traceLevel || 'off';
  if (!['mock', 'live'].includes(mode)) throw new Error('--mode must be mock or live');
  if (!['planner', 'worker'].includes(axis)) throw new Error('--axis must be planner or worker');
  if (!['none', 'mixed'].includes(faultProfile)) throw new Error('--fault-profile must be none or mixed');
  if (!['off', 'summary', 'redacted', 'full'].includes(traceLevel)) {
    throw new Error('--trace-level must be off, summary, redacted, or full');
  }

  const requestedCap = Number(args.maxCostUsd);
  if (mode === 'live' && (!Number.isFinite(requestedCap) || requestedCap <= 0)) {
    throw new Error('live mode requires an explicit positive --max-cost-usd');
  }
  if (mode === 'live' && requestedCap > config.maxExperimentCostUsd) {
    throw new Error(
      `requested cap $${requestedCap} exceeds configuration ceiling $${config.maxExperimentCostUsd}`,
    );
  }
  const budget = new CostBudget(mode === 'live' ? requestedCap : 0);
  const models = selectModels(args, config, axis);
  const summaries = [];
  let failedRuns = 0;

  if (mode === 'live') await assertBridgeAlive(config.bridgeUrl);

  for (const selectedModel of models) {
    const plannerModel = axis === 'planner' ? selectedModel : config.fixedPlannerModel;
    const workerModel = axis === 'worker' ? selectedModel : config.fixedWorkerModel;
    const runDir = makeRunDir({ mode, axis, plannerModel, workerModel, faultProfile });
    // A UUID fits the bridge's trace-ID rules and avoids leaking folder names
    // or model names into the filename stored under the user's home directory.
    const traceId = `prototype-${crypto.randomUUID()}`;
    const bridge =
      mode === 'live'
        ? new ClaudeBridge({
            runnerRepo: config.runnerRepo,
            bridgeUrl: config.bridgeUrl,
            callerToken: process.env.BRIDGE_CALLER_TOKEN,
            budget,
            effort: config.effort,
            traceLevel,
            traceId,
            runId: traceId,
          })
        : new MockBridge({ budget });
    const coordinator = new PhasedCoordinator({
      config,
      bridge,
      plannerModel,
      workerModel,
      faultProfile,
      runDir,
    });
    try {
      const result = await coordinator.run();
      summaries.push({
        runDir,
        plannerModel,
        workerModel,
        phase: result.phase,
        planMetrics: result.planMetrics,
        recoveryMetrics: result.recoveryMetrics || null,
        successes: result.results.filter((item) => item.ok).length,
        failures: result.results.filter((item) => !item.ok).length,
        synthesisOk: !result.synthesisFailure,
        synthesisFailure: result.synthesisFailure || null,
        estimatedCostUsd: budget.usedUsd,
        trace: bridge.traceMetadata ? bridge.traceMetadata() : null,
      });
    } catch (error) {
      failedRuns += 1;
      coordinator.state.phase = 'failed';
      coordinator.state.error = { name: error.name, message: error.message };
      coordinator.ledger.append('run_failed', coordinator.state.error);
      coordinator.checkpoint();
      summaries.push({
        runDir,
        plannerModel,
        workerModel,
        phase: 'failed',
        error: coordinator.state.error,
        estimatedCostUsd: budget.usedUsd,
        trace: bridge.traceMetadata ? bridge.traceMetadata() : null,
      });
    }
  }

  process.stdout.write(
    JSON.stringify({ mode, axis, faultProfile, traceLevel, summaries, budget }, null, 2) + '\n',
  );
  if (failedRuns) process.exitCode = 1;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--matrix') args.matrix = true;
    else if (value.startsWith('--')) {
      const key = value
        .slice(2)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = argv[++index];
    } else throw new Error(`unexpected argument: ${value}`);
  }
  return args;
}

function selectModels(args, config, axis) {
  const available = axis === 'planner' ? config.plannerModels : config.workerModels;
  if (args.model) {
    if (!available.includes(args.model)) throw new Error(`model is not configured for ${axis} axis: ${args.model}`);
    return [args.model];
  }
  if (args.matrix) return available;
  return [axis === 'planner' ? config.fixedPlannerModel : config.fixedWorkerModel];
}

function makeRunDir({ mode, axis, plannerModel, workerModel, faultProfile }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = [stamp, mode, axis, plannerModel, workerModel, faultProfile]
    .join('__')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const runDir = path.join(ROOT, 'runs', name);
  fs.mkdirSync(runDir, { recursive: false, mode: 0o700 });
  return runDir;
}

async function assertBridgeAlive(bridgeUrl) {
  const url = new URL(bridgeUrl);
  url.pathname = '/v1/debug';
  url.search = '';
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    throw new Error(`local bridge is not reachable at ${url}: ${error.message}`);
  }
  if (response.ok) return;

  // The bridge intentionally protects /v1/debug with a separate local token.
  // A locked 401 still proves that the expected bridge process answered. The
  // subsequent /v1/messages request remains the authoritative auth check.
  if (response.status === 401) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // A non-JSON 401 is not the bridge's documented locked-debug response.
    }
    if (payload?.error?.type === 'unauthorized' && /debug endpoint locked/i.test(payload.error.message || '')) {
      return;
    }
  }
  throw new Error(`local bridge debug endpoint returned HTTP ${response.status}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
