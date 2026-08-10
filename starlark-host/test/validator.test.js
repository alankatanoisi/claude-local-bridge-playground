'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateJobs } = require('../src/validator');

const policy = {
  maxJobsPerPhase: 2,
  inputIds: ['one', 'two'],
  workerNames: ['code_analyst'],
  defaultTimeoutMs: 30000,
  maxTimeoutMs: 60000,
  defaultMaxOutputTokens: 1000,
  maxOutputTokens: 1200,
  failedJobIds: [],
};

test('accepts a bounded initial job', () => {
  const jobs = validateJobs(
    [
      {
        id: 'analyze_one',
        worker: 'code_analyst',
        task: 'Analyze the supplied document carefully.',
        input_ids: ['one'],
        depends_on: [],
      },
    ],
    policy,
  );
  assert.equal(jobs[0].timeout_ms, 30000);
  assert.equal(jobs[0].max_output_tokens, 1000);
});

test('rejects model selection and unknown authority fields', () => {
  assert.throws(
    () =>
      validateJobs(
        [
          {
            id: 'bad',
            worker: 'code_analyst',
            model: 'claude-fable-5',
            task: 'Try to choose a model from generated code.',
            input_ids: ['one'],
          },
        ],
        policy,
      ),
    /unknown field 'model'/,
  );
});

test('recovery can retry only a retryable failed identifier supplied by the host', () => {
  const recoveryPolicy = { ...policy, failedJobIds: ['failed_one'] };
  assert.doesNotThrow(() =>
    validateJobs(
      [
        {
          id: 'retry_failed_one',
          retry_of: 'failed_one',
          worker: 'code_analyst',
          task: 'Retry the earlier bounded document analysis.',
          input_ids: ['one'],
          depends_on: [],
        },
      ],
      recoveryPolicy,
      'recovery',
    ),
  );
  assert.throws(
    () =>
      validateJobs(
        [
          {
            id: 'retry_unknown',
            retry_of: 'not_failed',
            worker: 'code_analyst',
            task: 'Retry something the host did not mark failed.',
            input_ids: ['one'],
            depends_on: [],
          },
        ],
        recoveryPolicy,
        'recovery',
      ),
    /must retry one failed job/,
  );
});

test('controlled trial requires one job per input when enabled', () => {
  const controlled = { ...policy, exactJobs: 2, oneInputPerJob: true, requireAllInputs: true };
  assert.throws(
    () =>
      validateJobs(
        [
          {
            id: 'combined',
            worker: 'code_analyst',
            task: 'Combine both documents into one analysis job.',
            input_ids: ['one', 'two'],
            depends_on: [],
          },
        ],
        controlled,
      ),
    /job count 1 must equal 2/,
  );
});

test('controlled trial rejects dependency edges that its dispatcher does not execute', () => {
  const controlled = { ...policy, allowDependencies: false };
  assert.throws(
    () =>
      validateJobs(
        [
          {
            id: 'dependent',
            worker: 'code_analyst',
            task: 'Wait for another generated job before running.',
            input_ids: ['one'],
            depends_on: ['other'],
          },
          {
            id: 'other',
            worker: 'code_analyst',
            task: 'Analyze the other document independently.',
            input_ids: ['two'],
            depends_on: [],
          },
        ],
        controlled,
      ),
    /requires independent jobs/,
  );
});
