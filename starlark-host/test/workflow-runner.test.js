'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { ROOT, prepareWorkflowDocuments, runWorkflow } = require('../src/workflow-runner');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'experiment.config.json'), 'utf8'));

test('repository workflow performs bounded host discovery', async () => {
  const collection = await prepareWorkflowDocuments({ config, workflowName: 'repo_fanout' });
  assert.equal(collection.documents.length, 6);
  assert.ok(collection.documents.every((document) => document.kind === 'repo_file'));
  assert.ok(collection.documents.every((document) => document.relativePath.startsWith('src/runner/')));
});

test('test-triage workflow collects the two intentional failures', async () => {
  const collection = await prepareWorkflowDocuments({ config, workflowName: 'test_triage' });
  assert.equal(collection.receipt.execution.exitCode, 1);
  assert.equal(collection.documents.length, 2);
  assert.ok(collection.documents.every((document) => document.kind === 'test_failure'));
});

test('provider-neutral registry executes repository fan-out in mock mode', async () => {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-repo-'));
  const result = await runWorkflow({
    config,
    workflowName: 'repo_fanout',
    mode: 'mock',
    plannerModel: 'mock-control',
    workerModel: 'mock-worker',
    faultProfile: 'none',
    traceLevel: 'off',
    runRoot,
  });
  assert.equal(result.phase, 'completed');
  assert.equal(result.inputs, 6);
  assert.equal(result.successes, 6);
  assert.equal(result.failures, 0);
  assert.ok(fs.existsSync(path.join(result.runDir, 'collection.json')));
});

test('test failure triage records deliberate failures and bounded recovery', async () => {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-triage-'));
  const result = await runWorkflow({
    config,
    workflowName: 'test_triage',
    mode: 'mock',
    plannerModel: 'mock-control',
    workerModel: 'mock-worker',
    faultProfile: 'mixed',
    traceLevel: 'off',
    runRoot,
  });
  assert.equal(result.phase, 'completed');
  assert.equal(result.inputs, 2);
  assert.equal(result.successes, 2);
  assert.equal(result.failures, 2);
  assert.equal(result.recoveryAttempts, 1);
});
