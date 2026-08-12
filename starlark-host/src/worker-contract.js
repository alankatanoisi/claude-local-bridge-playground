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
 * (parseWorkerOutput in coordinator.js) and any provider that formats output
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

module.exports = { WORKER_OUTPUT_LIMITS };
