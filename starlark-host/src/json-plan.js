'use strict';

/**
 * json-plan.js — the plain-JSON cheap path (R14c).
 *
 * The Starlark layer pays for itself when a plan needs bounded COMPUTE
 * (matrix expansion, cross products, conditional fan-out). The fan-out
 * workflows need none of that: their plan is fully determined by policy —
 * exactly one job per collected document, defaults from the worker profile.
 * For those, generating a program (two model calls in the worst case, plus a
 * Go evaluation) buys nothing.
 *
 * This module builds those descriptor lists directly on the host. The output
 * goes through the SAME validateJobs() gate as model-generated plans — the
 * cheap path skips the program layer, never the authority boundary.
 */

function buildHostJsonPlan({ documents, workerName, policy }) {
  return documents.map((document) => ({
    id: `analyze_${document.id}`,
    worker: workerName,
    task:
      `Analyze input ${document.id} for the stated objective. ` +
      'Report only evidence-backed findings from the supplied document.',
    input_ids: [document.id],
    depends_on: [],
    timeout_ms: policy.defaultTimeoutMs,
    max_output_tokens: policy.defaultMaxOutputTokens,
  }));
}

/** Deterministic recovery: retry every retryable failure verbatim, once. */
function buildHostJsonRecovery({ failures, policy }) {
  return failures
    .filter((failure) => failure.retryable)
    .map((failure) => ({
      id: `retry_${failure.job_id}`,
      retry_of: failure.job_id,
      worker: failure.worker,
      task: `${failure.task} This is a bounded retry; return strict JSON only.`,
      input_ids: failure.input_ids,
      depends_on: [],
      timeout_ms: policy.defaultTimeoutMs,
      max_output_tokens: policy.defaultMaxOutputTokens,
    }));
}

module.exports = { buildHostJsonPlan, buildHostJsonRecovery };
