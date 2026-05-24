'use strict';

const SCHEMA_VERSION = 1;

function shortToolUseId(id) {
  if (!id) return '';
  const s = String(id);
  return s.length <= 8 ? s : s.slice(0, 8);
}

function turnFilename(seq, kind, toolName, toolUseId) {
  let name = String(seq).padStart(3, '0') + '-' + kind;
  if (toolName) name += '-' + String(toolName).replace(/[^a-zA-Z0-9_-]/g, '_');
  const short = shortToolUseId(toolUseId);
  if (short) name += '-' + short;
  return name + '.json';
}

function buildTurnEnvelope(fields) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: fields.kind,
    seq: fields.seq,
    runId: fields.runId,
    sessionId: fields.sessionId ?? null,
    source: fields.source || 'live',
    legacyEra: fields.legacyEra || null,
    step: fields.step ?? null,
    ts: fields.ts || new Date().toISOString(),
    input: fields.input ?? {},
    output: fields.output ?? {},
  };
}

function scrubTurnObject(obj, scrubFn) {
  const copy = JSON.parse(JSON.stringify(obj));
  function walk(node) {
    if (typeof node === 'string') return scrubFn(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  }
  return walk(copy);
}

module.exports = {
  SCHEMA_VERSION,
  turnFilename,
  buildTurnEnvelope,
  scrubTurnObject,
  shortToolUseId,
};
