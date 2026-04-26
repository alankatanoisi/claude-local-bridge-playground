'use strict';

/**
 * GET /v1/models
 * Returns an OpenAI-compatible model listing of available Claude models.
 */

const { LISTED_MODELS } = require('../models');
const { sendJson } = require('../utils');

function handleModels(_ctx, _req, res) {
  const now = Math.floor(Date.now() / 1000);
  const models = LISTED_MODELS.map((m) => ({
    id: m.id,
    object: 'model',
    created: now,
    owned_by: m.owned_by,
    context_length: m.context_length,
    output_length: m.output_length,
  }));
  sendJson(res, 200, { object: 'list', data: models });
}

module.exports = { handleModels };
