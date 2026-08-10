'use strict';

const fs = require('fs');
const path = require('path');

// The host now lives inside the runner repository as a subtree (starlark-host/).
// HOST_ROOT is the subtree root. Relative config paths resolve against it, so
// commands behave the same whether launched from the repo root or the subtree.
const HOST_ROOT = path.resolve(__dirname, '..');

function resolveAgainstHostRoot(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(HOST_ROOT, value);
}

/**
 * Load experiment.config.json and normalize its two repository paths.
 *
 * - runnerRepo: the repository providing the model pricing / capability
 *   catalogs (this repo — the config default is "..").
 * - targetRoot: the repository whose files the workflows analyze (also ".."
 *   by default; may be pointed elsewhere for future campaigns).
 *
 * Normalizing here, at load time, keeps every downstream consumer
 * (coordinator, workflow-runner, bridge) working with absolute paths so no
 * behavior depends on the process working directory.
 */
function loadExperimentConfig(rootDir = HOST_ROOT) {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'experiment.config.json'), 'utf8'));
  config.runnerRepo = resolveAgainstHostRoot(config.runnerRepo);
  config.targetRoot = resolveAgainstHostRoot(config.targetRoot);
  return config;
}

module.exports = { HOST_ROOT, loadExperimentConfig, resolveAgainstHostRoot };
