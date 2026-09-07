'use strict';

const { loadExperimentConfig } = require('../../src/config');
const { buildHostJsonPlan, buildHostJsonRecovery } = require('../../src/json-plan');
const { validateJobs } = require('../../src/validator');

function acceptedPlans(fixture) {
  const config = loadExperimentConfig();
  const tokens = config.workerProfiles[fixture.workerName].maxOutputTokens;
  const policy = {
    maxJobsPerPhase: fixture.inputIds.length,
    inputIds: fixture.inputIds,
    workerNames: [fixture.workerName],
    defaultTimeoutMs: 30000,
    maxTimeoutMs: 60000,
    defaultMaxOutputTokens: tokens,
    maxOutputTokens: tokens,
    maxTaskCharacters: config.maxTaskCharacters,
    failedJobIds: [],
    exactJobs: fixture.inputIds.length,
    oneInputPerJob: true,
    requireAllInputs: true,
    allowDependencies: false,
  };
  const documents = fixture.inputIds.map((id) => ({ id, path: `${id}.txt` }));
  const plan = validateJobs(buildHostJsonPlan({ documents, workerName: fixture.workerName, policy }), policy, 'plan');
  // Include both retryable and permanent failures in each golden example.
  const failures = plan.map((job, index) => ({ job_id: job.id, ...job, retryable: index % 2 === 0 }));
  const recoveryPolicy = {
    ...policy,
    failedJobIds: failures.filter((failure) => failure.retryable).map((failure) => failure.job_id),
    exactJobs: undefined,
    requireAllInputs: false,
  };
  const recovery = validateJobs(
    buildHostJsonRecovery({ failures, policy: recoveryPolicy }),
    recoveryPolicy,
    'recovery',
  );
  return { plan, recovery };
}

module.exports = { acceptedPlans };
