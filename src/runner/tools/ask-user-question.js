'use strict';

/**
 * ask_user_question — structured clarification prompt for the human operator.
 *
 * Read-only category; interactive TTY required. Fail closed in workers,
 * --dont-ask, plan mode, and non-interactive environments.
 */

const { askUserQuestion } = require('../user-question');

function definition() {
  return {
    name: 'ask_user_question',
    description:
      'Ask the human operator a structured multiple-choice question before proceeding. ' +
      'Requires an interactive terminal; unavailable in child workers or --dont-ask runs.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Question text shown to the user',
        },
        header: {
          type: 'string',
          description: 'Optional short heading shown above the question',
        },
        options: {
          type: 'array',
          description: 'At least two choices',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['label'],
          },
        },
        allow_multiple: {
          type: 'boolean',
          description: 'Allow selecting more than one option',
        },
      },
      required: ['question', 'options'],
    },
  };
}

function execute(args, ctx) {
  return askUserQuestion(args || {}, ctx || {});
}

module.exports = {
  definition,
  execute,
  meta: { name: 'ask_user_question', category: 'read-only' },
};
