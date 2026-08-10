'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ClaudeBridge, CostBudget, MockBridge } = require('./bridge');
const { PhasedCoordinator } = require('./coordinator');
const { atomicWrite } = require('./ledger');
const { discoverRepositoryDocuments } = require('./repo-manifest');
const { collectTestFailureDocuments } = require('./test-triage');
const { createBridgeWorkerRegistry } = require('./worker-registry');

const ROOT = path.resolve(__dirname, '..');

/**
 * Prepare inputs using host-owned capabilities.
 *
 * The workflow configuration may name a repository collector or one approved
 * test suite. It cannot provide an arbitrary shell command at runtime.
 */
async function prepareWorkflowDocuments({ config, workflowName, prototypeRoot = ROOT }) {
  const workflow = config.workflows?.[workflowName];
  if (!workflow) throw new Error(`unknown workflow '${workflowName}'`);

  if (workflow.input?.type === 'repository') {
    const documents = discoverRepositoryDocuments({
      root: config.targetRoot,
      includeRoots: workflow.input.includeRoots,
      extensions: workflow.input.extensions,
      maxFiles: workflow.input.maxFiles,
      maxFileBytes: workflow.input.maxFileBytes,
      maxTotalBytes: workflow.input.maxTotalBytes,
    });
    if (documents.length === 0) throw new Error(`workflow '${workflowName}' selected no repository files`);
    return {
      documents,
      receipt: {
        type: 'repository',
        targetRoot: config.targetRoot,
        selected: documents.map(publicInput),
      },
    };
  }

  if (workflow.input?.type === 'test_suite') {
    const collected = await collectTestFailureDocuments({
      suiteName: workflow.input.suite,
      suites: config.testSuites,
      baseRoot: prototypeRoot,
    });
    if (collected.documents.length === 0) {
      throw new Error(`test suite '${collected.suite}' produced no parseable failures`);
    }
    return {
      documents: collected.documents,
      receipt: {
        type: 'test_suite',
        suite: collected.suite,
        execution: publicExecution(collected.execution),
        selected: collected.documents.map(publicInput),
      },
    };
  }

  throw new Error(`workflow '${workflowName}' has unsupported input type '${workflow.input?.type || ''}'`);
}

/**
 * Execute one workflow through the same coordinator used by the original
 * experiment. Concrete provider/model routes remain host-owned configuration.
 */
async function runWorkflow({
  config,
  workflowName,
  mode = 'mock',
  plannerModel = config.fixedPlannerModel,
  workerModel = config.fixedWorkerModel,
  faultProfile = 'none',
  traceLevel = config.traceLevel || 'off',
  maxCostUsd = 0,
  runRoot = path.join(ROOT, 'workflow-runs'),
  prototypeRoot = ROOT,
}) {
  validateRunOptions({ config, mode, faultProfile, traceLevel, maxCostUsd });
  const workflow = config.workflows[workflowName];
  const collection = await prepareWorkflowDocuments({ config, workflowName, prototypeRoot });
  const runDir = makeRunDir({ runRoot, workflowName, mode, plannerModel, workerModel, faultProfile });
  const budget = new CostBudget(mode === 'live' ? maxCostUsd : 0);
  const traceId = `workflow-${crypto.randomUUID()}`;
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
      : new MockBridge({ budget, workerName: workflow.worker });

  const modelRoutes = routesForProfiles(config.workerProfiles, workerModel);
  const workerRegistry = createBridgeWorkerRegistry({
    profiles: config.workerProfiles,
    bridge,
    modelRoutes,
  });
  const workflowConfig = {
    ...config,
    objective: workflow.objective,
    workerName: workflow.worker,
    // Every input must become exactly one job, but discovery already bounded
    // this count. Generated Starlark cannot expand the fan-out beyond it.
    maxJobsPerPhase: collection.documents.length,
  };
  const coordinator = new PhasedCoordinator({
    config: workflowConfig,
    bridge,
    plannerModel,
    workerModel,
    faultProfile,
    runDir,
    documents: collection.documents,
    workerName: workflow.worker,
    workerRegistry,
  });

  atomicWrite(path.join(runDir, 'collection.json'), collection.receipt);
  const started = Date.now();
  try {
    const state = await coordinator.run();
    return summarizeWorkflow({
      workflowName,
      mode,
      plannerModel,
      workerModel,
      faultProfile,
      runDir,
      durationMs: Date.now() - started,
      collection: collection.receipt,
      state,
      budget,
    });
  } catch (error) {
    coordinator.state.phase = 'failed';
    coordinator.state.error = { name: error.name, message: error.message };
    coordinator.ledger.append('run_failed', coordinator.state.error);
    coordinator.checkpoint();
    error.runDir = runDir;
    throw error;
  }
}

function routesForProfiles(profiles, workerModel) {
  const routes = {};
  for (const profile of Object.values(profiles)) {
    routes[profile.route] = {
      provider: 'local_claude_bridge',
      model: workerModel,
    };
  }
  return routes;
}

function validateRunOptions({ config, mode, faultProfile, traceLevel, maxCostUsd }) {
  if (!['mock', 'live'].includes(mode)) throw new Error('mode must be mock or live');
  if (!['none', 'mixed'].includes(faultProfile)) throw new Error('fault profile must be none or mixed');
  if (!['off', 'summary', 'redacted', 'full'].includes(traceLevel)) throw new Error('invalid trace level');
  if (mode === 'live' && (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0)) {
    throw new Error('live mode requires an explicit positive cost cap');
  }
  if (mode === 'live' && maxCostUsd > config.maxExperimentCostUsd) {
    throw new Error(`cost cap $${maxCostUsd} exceeds configured ceiling $${config.maxExperimentCostUsd}`);
  }
}

function makeRunDir({ runRoot, workflowName, mode, plannerModel, workerModel, faultProfile }) {
  fs.mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomUUID().slice(0, 8);
  const name = [stamp, workflowName, mode, plannerModel, workerModel, faultProfile, suffix]
    .join('__')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  const runDir = path.join(runRoot, name);
  fs.mkdirSync(runDir, { mode: 0o700 });
  return runDir;
}

function publicInput(document) {
  return {
    id: document.id,
    kind: document.kind,
    path: document.relativePath,
    bytes: document.bytes,
    sha256: document.sha256,
    metadata: document.metadata || {},
  };
}

function publicExecution(execution) {
  return {
    command: execution.command,
    cwd: execution.cwd,
    exitCode: execution.exitCode,
    signal: execution.signal,
    timedOut: execution.timedOut,
    truncated: execution.truncated,
    stdoutBytes: Buffer.byteLength(execution.stdout),
    stderrBytes: Buffer.byteLength(execution.stderr),
  };
}

function summarizeWorkflow({
  workflowName,
  mode,
  plannerModel,
  workerModel,
  faultProfile,
  runDir,
  durationMs,
  collection,
  state,
  budget,
}) {
  return {
    workflow: workflowName,
    mode,
    plannerModel,
    workerModel,
    faultProfile,
    phase: state.phase,
    inputs: collection.selected.length,
    planAttempts: state.planMetrics?.attempts || 0,
    recoveryAttempts: state.recoveryMetrics?.attempts || 0,
    successes: state.results.filter((item) => item.ok).length,
    failures: state.results.filter((item) => !item.ok).length,
    synthesisOk: !state.synthesisFailure,
    durationMs,
    estimatedCostUsd: budget.usedUsd,
    runDir,
    trace: state.trace,
  };
}

module.exports = {
  ROOT,
  prepareWorkflowDocuments,
  routesForProfiles,
  runWorkflow,
  summarizeWorkflow,
  validateRunOptions,
};
