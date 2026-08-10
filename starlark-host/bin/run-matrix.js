#!/usr/bin/env node
'use strict';

const path = require('path');

const { loadExperimentConfig } = require('../src/config');
const { generateEvaluationMatrix, runOfflineMatrix } = require('../src/evaluation-matrix');
const { ROOT } = require('../src/workflow-runner');

async function main() {
  const config = loadExperimentConfig();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const matrixDir = path.join(ROOT, 'matrix-runs', stamp);
  const matrix = await generateEvaluationMatrix();
  const outcome = await runOfflineMatrix({ config, matrix, matrixDir });
  process.stdout.write(JSON.stringify({ matrixDir, matrix, summary: outcome.summary }, null, 2) + '\n');
  if (outcome.summary.failedCases) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
