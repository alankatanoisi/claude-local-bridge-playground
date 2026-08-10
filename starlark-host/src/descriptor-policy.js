'use strict';

/**
 * descriptor-policy.js — the single source of truth for job-descriptor policy (R5).
 *
 * Before this module, the same policy lived in three places that could drift
 * apart: hardcoded bounds inside validator.js, hand-written policy text inside
 * the planner prompts, and the per-run policy object built by the coordinator.
 * Field finding 1 (2026-08-06) showed what that drift costs: a prompt that
 * names a field without its bounds invites out-of-policy plans that burn a
 * repair attempt.
 *
 * Now:
 * - validator.js imports its allowed keys and fixed lower bounds from here.
 * - The planner/recovery prompts render their CONTROLLED-TRIAL POLICY section
 *   from here (policyDisclosure), so the numbers the model reads are, by
 *   construction, the numbers the validator enforces.
 * - test/descriptor-policy.test.js holds the field→enforcement concordance:
 *   every accepted field must name its enforcement point, and the functional
 *   probes assert the value actually reaches that point at execution time
 *   (the finding-6 `timeout_ms` class: "validated but not enforced" should be
 *   a failing test, not a field discovery).
 */

// Fixed lower bounds. Upper bounds are campaign policy (config/worker profile)
// and arrive through the per-run policy object.
const LIMITS = Object.freeze({
  timeoutMinMs: 1000,
  outputTokensMin: 100,
  taskMinCharacters: 10,
  taskMaxCharactersDefault: 2000,
  idPattern: /^[a-z][a-z0-9_-]{0,63}$/,
});

/**
 * Every field a job descriptor may carry. `phases` says where the field is
 * allowed; `enforcement` documents WHERE the accepted value takes effect —
 * the concordance test fails if a field ever lacks one.
 */
const DESCRIPTOR_FIELDS = Object.freeze([
  {
    name: 'id',
    phases: ['plan', 'recovery'],
    enforcement: 'validator identity/uniqueness; ledger job_* events and artifact names key on it',
  },
  {
    name: 'worker',
    phases: ['plan', 'recovery'],
    enforcement: 'worker registry resolves it to a host-owned route at execute()',
  },
  {
    name: 'task',
    phases: ['plan', 'recovery'],
    enforcement: 'embedded in the worker prompt (buildWorkerPrompt); length bounds at validator',
  },
  {
    name: 'input_ids',
    phases: ['plan', 'recovery'],
    enforcement: 'resolved to bounded documents; their text is what the worker receives',
  },
  {
    name: 'depends_on',
    phases: ['plan', 'recovery'],
    enforcement:
      'validator: must be empty while allowDependencies is false (the scheduler intentionally implements no ordering, so a non-empty list would be validated-but-unenforced — hence rejected)',
  },
  {
    name: 'timeout_ms',
    phases: ['plan', 'recovery'],
    enforcement: 'passed to the bridge call abort signal (finding-6 fix; probed by concordance test)',
  },
  {
    name: 'max_output_tokens',
    phases: ['plan', 'recovery'],
    enforcement: 'becomes the Messages max_tokens; registry clamps to the worker profile ceiling',
  },
  {
    name: 'retry_of',
    phases: ['recovery'],
    enforcement: 'validator: must name a retryable failed job; recorded on ledger for retry accounting',
  },
]);

const ALLOWED_KEYS = Object.freeze(new Set(DESCRIPTOR_FIELDS.map((field) => field.name)));

function fieldsForPhase(phase) {
  return DESCRIPTOR_FIELDS.filter((field) => field.phases.includes(phase)).map((field) => field.name);
}

/**
 * Render the CONTROLLED-TRIAL POLICY prompt section from the same data the
 * validator enforces. `policy` is the coordinator's per-run policy object.
 */
function policyDisclosure({ policy, phase, workerName, documentCount }) {
  const taskMax = policy.maxTaskCharacters || LIMITS.taskMaxCharactersDefault;
  const lines = [];
  if (phase === 'plan') {
    lines.push(
      `- Return exactly ${documentCount} independent jobs: exactly one job for each input ID, with every input covered once.`,
      `- Use worker ${workerName} and one input_id per job.`,
    );
  } else {
    lines.push(
      `- Return at most ${policy.maxJobsPerPhase} retry jobs and retry only failures whose retryable field is true.`,
      `- Each retry must preserve the failed job's worker and input_ids and name that job in retry_of.`,
    );
  }
  lines.push(
    `- depends_on must be an empty list.`,
    `- timeout_ms must be an integer from ${LIMITS.timeoutMinMs} through ${policy.maxTimeoutMs}; use ${policy.defaultTimeoutMs}.`,
    `- max_output_tokens must be an integer from ${LIMITS.outputTokensMin} through ${policy.maxOutputTokens}; use ${policy.defaultMaxOutputTokens}.`,
    `- task must be ${LIMITS.taskMinCharacters} through ${taskMax} characters.`,
    `- Each job must contain exactly: ${fieldsForPhase(phase).join(', ')}.`,
  );
  if (phase === 'plan') {
    lines.push('- Do not include retry_of in the initial plan. Do not choose or name a model ID or provider.');
  } else {
    lines.push('- Do not choose or name a model ID.');
  }
  const heading = phase === 'plan' ? 'CONTROLLED-TRIAL POLICY (the host rejects any violation)' : 'RECOVERY POLICY (the host rejects any violation)';
  return `${heading}:\n${lines.join('\n')}`;
}

module.exports = { ALLOWED_KEYS, DESCRIPTOR_FIELDS, LIMITS, fieldsForPhase, policyDisclosure };
