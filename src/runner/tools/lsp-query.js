'use strict';

/**
 * lsp_query — code intelligence via a local Language Server Protocol process.
 *
 * Opt-in with --enable-lsp because it spawns long-lived helper processes.
 */

const { runLspQuery } = require('../lsp/lsp-session');

function definition() {
  return {
    name: 'lsp_query',
    description:
      'Query a local language server for definition, references, hover, or diagnostics. ' +
      'Requires --enable-lsp and a compatible language server on PATH (e.g. typescript-language-server).',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['definition', 'references', 'hover', 'diagnostics'],
          description: 'LSP operation to run',
        },
        path: {
          type: 'string',
          description: 'Relative source file path inside the project',
        },
        line: {
          type: 'number',
          description: '1-based line number (default 1)',
        },
        character: {
          type: 'number',
          description: '0-based character offset (default 0)',
        },
      },
      required: ['action', 'path'],
    },
  };
}

async function execute(args, ctx) {
  if (!(ctx && ctx.enableLsp)) {
    return {
      ok: false,
      text: 'lsp_query is disabled. Re-run with --enable-lsp after installing a language server.',
    };
  }
  return runLspQuery(args || {}, ctx);
}

module.exports = {
  definition,
  execute,
  meta: { name: 'lsp_query', category: 'read-only' },
};
