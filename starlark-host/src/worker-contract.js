'use strict';

/**
 * worker-contract.js — the single source of truth for worker output limits.
 *
 * History matters here. The original limits (summary ≤700 chars) were tuned on
 * 2026-08-06 by tightening until one model's (Sonnet 5's) artifacts survived —
 * token-spend conservatism, not orchestration design. The two-axis evaluation
 * (docs/starlark-r4-worker-eval-2026-08-10.md) then showed that ceiling was
 * the pipeline's dominant failure mode: moderate 1.3–1.7× overshoots destroyed
 * entire artifacts, and Opus 5 lost 15/15 retries to that one constraint.
 *
 * Owner decision (Alan, 2026-08-10): favor integrity of orchestration and
 * worker communication over rigidity — workers stay bounded, but not so bound
 * they cannot deliver their findings. Summary ceiling raised 700 → 1200.
 *
 * These constants are consumed by BOTH the enforcement point
 * (parseWorkerOutput, below) and any provider that formats output
 * to the contract; the worker system prompts in experiment.config.json must
 * disclose the same numbers, and test/worker-contract.test.js fails the gate
 * if they drift (the R5 disclosed-and-enforced discipline, applied to the
 * worker contract).
 */

const WORKER_OUTPUT_LIMITS = Object.freeze({
  summaryMaxChars: 1200,
  claimsMax: 4,
  claimMaxChars: 300,
  evidenceMax: 4,
  evidenceMaxChars: 300,
});

// The enforcement point. Every worker answer — live bridge, mock, or the
// deterministic analyst — passes through here before it can become a
// `job_succeeded` artifact, and worker-resume.js re-parses saved artifacts
// through the same function so a resumed result obeys the same contract.
function parseWorkerOutput(text) {
  const limits = WORKER_OUTPUT_LIMITS;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const output = JSON.parse(cleaned);
  const keys = Object.keys(output).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['claims', 'confidence', 'evidence', 'summary'])) {
    throw new Error('worker JSON must contain exactly summary, claims, evidence, confidence');
  }
  if (typeof output.summary !== 'string' || !output.summary.trim() || output.summary.length > limits.summaryMaxChars) {
    throw new Error(`summary must be 1..${limits.summaryMaxChars} characters`);
  }
  if (
    !Array.isArray(output.claims) ||
    output.claims.length > limits.claimsMax ||
    output.claims.some((value) => typeof value !== 'string' || value.length > limits.claimMaxChars)
  ) {
    throw new Error(
      `claims must contain at most ${limits.claimsMax} strings of at most ${limits.claimMaxChars} characters`,
    );
  }
  if (
    !Array.isArray(output.evidence) ||
    output.evidence.length > limits.evidenceMax ||
    output.evidence.some((value) => typeof value !== 'string' || value.length > limits.evidenceMaxChars)
  ) {
    throw new Error(
      `evidence must contain at most ${limits.evidenceMax} strings of at most ${limits.evidenceMaxChars} characters`,
    );
  }
  if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
    throw new Error('confidence must be between 0 and 1');
  }
  return output;
}

module.exports = { WORKER_OUTPUT_LIMITS, parseWorkerOutput };
