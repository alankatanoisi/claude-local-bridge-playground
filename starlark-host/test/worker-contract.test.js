'use strict';

/**
 * Worker-contract concordance (the R5 discipline applied to worker output).
 *
 * The summary ceiling drifted into three prompt strings and one hardcoded
 * parser check before this test existed. Now: worker-contract.js is the
 * single source; parseWorkerOutput enforces from it; and every worker system
 * prompt in experiment.config.json must DISCLOSE the same numbers it will be
 * judged by. Change the constant and forget a prompt → this fails the gate.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { parseWorkerOutput } = require('../src/coordinator');
const { loadExperimentConfig } = require('../src/config');
const { WORKER_OUTPUT_LIMITS } = require('../src/worker-contract');

test('every worker system prompt discloses the enforced summary ceiling', () => {
  const config = loadExperimentConfig();
  const disclosure = `summary (string of at most ${WORKER_OUTPUT_LIMITS.summaryMaxChars} characters)`;
  for (const [name, profile] of Object.entries(config.workerProfiles)) {
    assert.ok(
      profile.system.includes(disclosure),
      `worker profile '${name}' must disclose "${disclosure}" — its prompt and the parser have drifted`,
    );
    assert.match(
      profile.system,
      new RegExp(`at most ${WORKER_OUTPUT_LIMITS.claimsMax} strings, each at most ${WORKER_OUTPUT_LIMITS.claimMaxChars} characters`),
      `worker profile '${name}' must disclose the claims/evidence bounds`,
    );
  }
});

test('the parser enforces exactly the contract constants (boundary probes)', () => {
  const limits = WORKER_OUTPUT_LIMITS;
  const artifact = (summaryLength) =>
    JSON.stringify({
      summary: 'x'.repeat(summaryLength),
      claims: Array.from({ length: limits.claimsMax }, () => 'c'.repeat(limits.claimMaxChars)),
      evidence: Array.from({ length: limits.evidenceMax }, () => 'e'.repeat(limits.evidenceMaxChars)),
      confidence: 0.5,
    });

  // At the boundary: accepted.
  assert.doesNotThrow(() => parseWorkerOutput(artifact(limits.summaryMaxChars)));
  // One character over: rejected, and the error names the real ceiling.
  assert.throws(
    () => parseWorkerOutput(artifact(limits.summaryMaxChars + 1)),
    new RegExp(`1\\.\\.${limits.summaryMaxChars} characters`),
  );
  // Claims/evidence budgets remain enforced from the same constants.
  const overClaim = JSON.parse(artifact(10));
  overClaim.claims = ['c'.repeat(limits.claimMaxChars + 1)];
  assert.throws(() => parseWorkerOutput(JSON.stringify(overClaim)), /claims must contain/);
});

test('the owner decision is in force: ceiling is 1200, not the tuned-on-Sonnet 700', () => {
  // Deliberately a literal, not the constant: this test pins the DECISION
  // (Alan, 2026-08-10 — communication integrity over rigidity). If someone
  // lowers the constant back toward spend-conservatism, this fails and points
  // at the decision record instead of silently re-tightening the contract.
  assert.equal(WORKER_OUTPUT_LIMITS.summaryMaxChars, 1200);
});
