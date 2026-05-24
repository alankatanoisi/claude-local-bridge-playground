'use strict';

const path = require('path');

function bridgeRunnerHome() {
  if (process.env.BRIDGE_RUNNER_HOME) return process.env.BRIDGE_RUNNER_HOME;
  return path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.bridge-runner');
}

function archiveRoot() {
  if (process.env.BRIDGE_RUNNER_ARCHIVE_ROOT) return process.env.BRIDGE_RUNNER_ARCHIVE_ROOT;
  return path.join(bridgeRunnerHome(), 'archive');
}

function indexDir() {
  return path.join(archiveRoot(), 'index');
}

function catalogJsonlPath() {
  return path.join(indexDir(), 'catalog.jsonl');
}

function catalogLatestPath() {
  return path.join(indexDir(), 'catalog.latest.json');
}

function sessionsIndexPath() {
  return path.join(indexDir(), 'sessions.index.json');
}

function runsDir() {
  return path.join(archiveRoot(), 'runs');
}

function runDir(runId) {
  return path.join(runsDir(), runId);
}

function turnsDir(runId) {
  return path.join(runDir(runId), 'turns');
}

function archiveSessionsDir() {
  return path.join(archiveRoot(), 'sessions');
}

function archiveSessionDir(sessionId) {
  return path.join(archiveSessionsDir(), sessionId);
}

function exportsCsvDir() {
  return path.join(archiveRoot(), 'exports', 'csv');
}

function exportsWorkbookPath() {
  return path.join(archiveRoot(), 'exports', 'workbook', 'runner-runs.xlsx');
}

function legacyLogsDir() {
  return path.join(bridgeRunnerHome(), 'logs');
}

function sessionsDir() {
  return path.join(bridgeRunnerHome(), 'sessions');
}

module.exports = {
  bridgeRunnerHome,
  archiveRoot,
  indexDir,
  catalogJsonlPath,
  catalogLatestPath,
  sessionsIndexPath,
  runsDir,
  runDir,
  turnsDir,
  archiveSessionsDir,
  archiveSessionDir,
  exportsCsvDir,
  exportsWorkbookPath,
  legacyLogsDir,
  sessionsDir,
};
