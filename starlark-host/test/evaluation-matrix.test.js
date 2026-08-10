'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { generateEvaluationMatrix, validateMatrix } = require('../src/evaluation-matrix');

test('Starlark expands the bounded eight-case evaluation matrix', async () => {
  const matrix = await generateEvaluationMatrix();
  assert.equal(matrix.cases.length, 8);
  assert.equal(new Set(matrix.cases.map((entry) => entry.id)).size, 8);
  assert.ok(matrix.starlarkSteps > 0);
});

test('host rejects an evaluation case that adds provider authority', () => {
  assert.throws(
    () =>
      validateMatrix(
        [
          {
            id: 'bad',
            workflow: 'repo_fanout',
            control_model: 'claude-haiku-4-5',
            fault_profile: 'none',
            repetition: 1,
            provider: 'invented',
          },
        ],
        {
          workflows: ['repo_fanout'],
          controlModels: ['claude-haiku-4-5'],
          faultProfiles: ['none'],
          repetitions: 1,
          maxCases: 1,
        },
      ),
    /must contain exactly/,
  );
});
