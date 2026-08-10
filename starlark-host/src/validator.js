'use strict';

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const ALLOWED_KEYS = new Set([
  'id',
  'worker',
  'task',
  'input_ids',
  'depends_on',
  'timeout_ms',
  'max_output_tokens',
  'retry_of',
]);

function validateJobs(raw, policy, phase = 'plan') {
  if (!Array.isArray(raw)) throw new Error('Starlark result must be a list of job descriptors');
  if (policy.exactJobs !== undefined && raw.length !== policy.exactJobs) {
    throw new Error(`job count ${raw.length} must equal ${policy.exactJobs} for this controlled trial`);
  }
  if (raw.length > policy.maxJobsPerPhase) {
    throw new Error(`job count ${raw.length} exceeds phase limit ${policy.maxJobsPerPhase}`);
  }

  const knownInputs = new Set(policy.inputIds);
  const knownWorkers = new Set(policy.workerNames);
  const seen = new Set();
  const jobs = raw.map((job, index) => {
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      throw new Error(`job ${index} must be an object`);
    }
    for (const key of Object.keys(job)) {
      if (!ALLOWED_KEYS.has(key)) throw new Error(`job ${index} contains unknown field '${key}'`);
    }
    if (!ID_PATTERN.test(job.id || '')) throw new Error(`job ${index} has invalid id`);
    if (seen.has(job.id)) throw new Error(`duplicate job id '${job.id}'`);
    seen.add(job.id);
    if (!knownWorkers.has(job.worker)) throw new Error(`job '${job.id}' requests unknown worker '${job.worker}'`);
    const maxTaskCharacters = policy.maxTaskCharacters || 2000;
    if (typeof job.task !== 'string' || job.task.length < 10 || job.task.length > maxTaskCharacters) {
      throw new Error(`job '${job.id}' task must be 10..${maxTaskCharacters} characters`);
    }
    if (!Array.isArray(job.input_ids) || job.input_ids.length < 1) {
      throw new Error(`job '${job.id}' must reference at least one input`);
    }
    if (policy.oneInputPerJob && job.input_ids.length !== 1) {
      throw new Error(`job '${job.id}' must reference exactly one input for this controlled trial`);
    }
    for (const inputId of job.input_ids) {
      if (!knownInputs.has(inputId)) throw new Error(`job '${job.id}' references unknown input '${inputId}'`);
    }
    const dependsOn = job.depends_on === undefined ? [] : job.depends_on;
    if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== 'string')) {
      throw new Error(`job '${job.id}' depends_on must be a string list`);
    }
    if (policy.allowDependencies === false && dependsOn.length > 0) {
      throw new Error(`job '${job.id}' declares dependencies, but this controlled trial requires independent jobs`);
    }
    const timeoutMs = job.timeout_ms === undefined ? policy.defaultTimeoutMs : job.timeout_ms;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > policy.maxTimeoutMs) {
      throw new Error(`job '${job.id}' timeout is outside policy`);
    }
    const maxOutputTokens =
      job.max_output_tokens === undefined ? policy.defaultMaxOutputTokens : job.max_output_tokens;
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 100 || maxOutputTokens > policy.maxOutputTokens) {
      throw new Error(`job '${job.id}' max_output_tokens is outside policy`);
    }
    if (phase === 'recovery') {
      if (!job.retry_of || !policy.failedJobIds.includes(job.retry_of)) {
        throw new Error(`recovery job '${job.id}' must retry one failed job`);
      }
    } else if (job.retry_of !== undefined) {
      throw new Error(`initial job '${job.id}' cannot set retry_of`);
    }
    return {
      id: job.id,
      worker: job.worker,
      task: job.task,
      input_ids: [...new Set(job.input_ids)],
      depends_on: [...new Set(dependsOn)],
      timeout_ms: timeoutMs,
      max_output_tokens: maxOutputTokens,
      ...(job.retry_of ? { retry_of: job.retry_of } : {}),
    };
  });

  for (const job of jobs) {
    for (const dependency of job.depends_on) {
      if (!seen.has(dependency)) throw new Error(`job '${job.id}' depends on unknown job '${dependency}'`);
      if (dependency === job.id) throw new Error(`job '${job.id}' depends on itself`);
    }
  }
  assertAcyclic(jobs);
  if (policy.requireAllInputs) {
    const covered = jobs.flatMap((job) => job.input_ids);
    for (const inputId of policy.inputIds) {
      const count = covered.filter((candidate) => candidate === inputId).length;
      if (count !== 1) throw new Error(`input '${inputId}' must be covered exactly once; observed ${count}`);
    }
  }
  return jobs;
}

function assertAcyclic(jobs) {
  const dependencies = new Map(jobs.map((job) => [job.id, job.depends_on]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`dependency cycle contains '${id}'`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const job of jobs) visit(job.id);
}

module.exports = { validateJobs };
