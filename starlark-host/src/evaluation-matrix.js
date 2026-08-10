'use strict';

const fs = require('fs');
const path = require('path');

const { atomicWrite } = require('./ledger');
const { evaluateStarlark } = require('./starlark');
const { ROOT, runWorkflow } = require('./workflow-runner');

const MATRIX_KEYS = ['control_model', 'fault_profile', 'id', 'repetition', 'workflow'];
const DEFAULT_PARAMETERS = Object.freeze({
  workflows: ['repo_fanout', 'test_triage'],
  controlModels: ['claude-haiku-4-5', 'claude-sonnet-5'],
  faultProfiles: ['none', 'mixed'],
  repetitions: 1,
  maxCases: 8,
});

async function generateEvaluationMatrix({
  source = fs.readFileSync(path.join(ROOT, 'starlark', 'evaluation-matrix.star'), 'utf8'),
  workflows = DEFAULT_PARAMETERS.workflows,
  controlModels = DEFAULT_PARAMETERS.controlModels,
  faultProfiles = DEFAULT_PARAMETERS.faultProfiles,
  repetitions = DEFAULT_PARAMETERS.repetitions,
  maxCases = DEFAULT_PARAMETERS.maxCases,
  maxSteps = 50000,
  timeoutMs = 1000,
} = {}) {
  const evaluated = await evaluateStarlark({
    source,
    functionName: 'matrix',
    context: {
      workflows,
      control_models: controlModels,
      fault_profiles: faultProfiles,
      repetitions,
    },
    maxSteps,
    timeoutMs,
  });
  return {
    cases: validateMatrix(evaluated.result, {
      workflows,
      controlModels,
      faultProfiles,
      repetitions,
      maxCases,
    }),
    starlarkSteps: evaluated.steps,
  };
}

function validateMatrix(raw, policy) {
  if (!Array.isArray(raw)) throw new Error('evaluation matrix must be a list');
  if (raw.length > policy.maxCases) {
    throw new Error(`evaluation matrix has ${raw.length} cases; maximum is ${policy.maxCases}`);
  }
  const expectedCount =
    policy.workflows.length *
    policy.controlModels.length *
    policy.faultProfiles.length *
    policy.repetitions;
  if (raw.length !== expectedCount) {
    throw new Error(`evaluation matrix has ${raw.length} cases; expected ${expectedCount}`);
  }

  const allowedWorkflows = new Set(policy.workflows);
  const allowedModels = new Set(policy.controlModels);
  const allowedFaults = new Set(policy.faultProfiles);
  const seen = new Set();
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`matrix case ${index} must be an object`);
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(MATRIX_KEYS)) {
      throw new Error(`matrix case ${index} must contain exactly ${MATRIX_KEYS.join(', ')}`);
    }
    if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9._-]{1,180}$/.test(entry.id)) {
      throw new Error(`matrix case ${index} has an invalid id`);
    }
    if (seen.has(entry.id)) throw new Error(`duplicate matrix case '${entry.id}'`);
    seen.add(entry.id);
    if (!allowedWorkflows.has(entry.workflow)) throw new Error(`matrix case '${entry.id}' has unknown workflow`);
    if (!allowedModels.has(entry.control_model)) throw new Error(`matrix case '${entry.id}' has unknown model`);
    if (!allowedFaults.has(entry.fault_profile)) throw new Error(`matrix case '${entry.id}' has unknown fault profile`);
    if (!Number.isInteger(entry.repetition) || entry.repetition < 1 || entry.repetition > policy.repetitions) {
      throw new Error(`matrix case '${entry.id}' has invalid repetition`);
    }
    return { ...entry };
  });
}

/**
 * Run a validated matrix sequentially in mock mode.
 *
 * Sequential execution makes receipts and intentional test subprocesses easy
 * to inspect. A later live phase can add bounded parallelism only after costs
 * and provider behavior are understood.
 */
async function runOfflineMatrix({ config, matrix, matrixDir }) {
  fs.mkdirSync(matrixDir, { recursive: true, mode: 0o700 });
  atomicWrite(path.join(matrixDir, 'matrix.json'), matrix);
  const results = [];

  for (const entry of matrix.cases) {
    try {
      const result = await runWorkflow({
        config,
        workflowName: entry.workflow,
        mode: 'mock',
        plannerModel: entry.control_model,
        workerModel: config.fixedWorkerModel,
        faultProfile: entry.fault_profile,
        traceLevel: 'off',
        runRoot: path.join(matrixDir, 'cases'),
      });
      results.push({ id: entry.id, ok: true, ...result });
    } catch (error) {
      results.push({
        id: entry.id,
        ok: false,
        workflow: entry.workflow,
        plannerModel: entry.control_model,
        faultProfile: entry.fault_profile,
        error: { name: error.name, message: error.message },
        runDir: error.runDir || null,
      });
    }
    atomicWrite(path.join(matrixDir, 'results.json'), { cases: results });
  }

  const summary = summarizeMatrix(results);
  atomicWrite(path.join(matrixDir, 'summary.json'), summary);
  return { results, summary };
}

function summarizeMatrix(results) {
  const completed = results.filter((result) => result.ok && result.phase === 'completed').length;
  return {
    totalCases: results.length,
    completedCases: completed,
    failedCases: results.length - completed,
    synthesisSuccesses: results.filter((result) => result.synthesisOk).length,
    totalInputs: results.reduce((sum, result) => sum + (result.inputs || 0), 0),
    totalSuccessfulAttempts: results.reduce((sum, result) => sum + (result.successes || 0), 0),
    totalFailedAttempts: results.reduce((sum, result) => sum + (result.failures || 0), 0),
    totalEstimatedCostUsd: results.reduce((sum, result) => sum + (result.estimatedCostUsd || 0), 0),
  };
}

module.exports = {
  DEFAULT_PARAMETERS,
  generateEvaluationMatrix,
  runOfflineMatrix,
  summarizeMatrix,
  validateMatrix,
};
