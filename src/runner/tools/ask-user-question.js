'use strict';

/**
 * ask_user_question — structured clarification prompt for the human operator.
 *
 * Read-only category. A hosted caller (ACP, kernel) injects its own asker via
 * ctx.askUserQuestion; the terminal path prompts on /dev/tty. Fails closed in
 * workers, --dont-ask, plan mode, and non-interactive environments.
 */

const { askUserQuestion } = require('../user-question');

function definition() {
  return {
    name: 'ask_user_question',
    description:
      'Ask the human operator a multiple-choice question and wait for their answer. ' +
      'The operator expects to be consulted: prefer asking over guessing whenever a real ' +
      'decision point has two or more defensible options (scope, naming, which of several ' +
      'matches was meant, destructive vs conservative variants). Provide 2-5 concrete ' +
      'options; the result reports the selected label(s). If no operator channel exists ' +
      'the call fails with an explanation - then proceed on your best safe assumption.',
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
  // A hosted caller (no terminal) injects its own asker on the context; without
  // one we use the /dev/tty prompt, which fails closed when there is no terminal.
  if (ctx && typeof ctx.askUserQuestion === 'function') {
    return ctx.askUserQuestion(args || {}, ctx);
  }
  return askUserQuestion(args || {}, ctx || {});
}

module.exports = {
  definition,
  execute,
  meta: { name: 'ask_user_question', category: 'read-only' },
};
