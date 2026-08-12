'use strict';

/**
 * deterministic-analyst.js — the second worker provider (R9).
 *
 * The worker registry's provider seam has carried exactly one live adapter
 * (the local Claude bridge) since it was built, which made "provider-neutral"
 * a structural claim, not an observed one. This module is the cheapest honest
 * second adapter: a deterministic static profiler that serves the same
 * execute() contract — same request fields in, same response envelope and
 * strict four-field worker JSON out — with zero model calls and zero cost.
 *
 * It deliberately does NOT pretend to be intelligent. Its summary/claims/
 * evidence are computed textual facts (sizes, line counts, longest line,
 * marker counts), so its output is byte-for-byte reproducible for identical
 * inputs. That determinism is the point: any behavioral difference between a
 * bridge-backed run and a deterministic-backed run is attributable to the
 * provider swap alone, which is exactly what a contract test needs.
 */

const crypto = require('crypto');

const { WORKER_OUTPUT_LIMITS } = require('./worker-contract');

/** Extract the DOCUMENT sections buildWorkerPrompt() embeds in the prompt. */
function extractDocuments(prompt) {
  const documents = [];
  const pattern = /DOCUMENT (\S+) \(([^,]+), sha256 ([0-9a-f]+)\):\n/g;
  const matches = [...prompt.matchAll(pattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : prompt.length;
    documents.push({
      id: matches[index][1],
      path: matches[index][2],
      sha256: matches[index][3],
      text: prompt.slice(start, end),
    });
  }
  return documents;
}

function clamp(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function analyzeDocument(document) {
  const lines = document.text.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const markers = (document.text.match(/\b(?:TODO|FIXME|HACK|XXX)\b/g) || []).length;
  const functions = (document.text.match(/\bfunction\b|=>/g) || []).length;
  const requires = (document.text.match(/\brequire\s*\(/g) || []).length;
  return {
    summary: clamp(
      `Deterministic profile of ${document.path}: ${lines.length} lines, ` +
        `${Buffer.byteLength(document.text)} bytes, longest line ${longest} chars, ` +
        `${requires} require() calls, ${functions} function-ish tokens, ${markers} TODO/FIXME markers. ` +
        'Computed textual facts only; no semantic judgment.',
      WORKER_OUTPUT_LIMITS.summaryMaxChars,
    ),
    claims: [
      clamp(`Document ${document.id} spans ${lines.length} lines (${Buffer.byteLength(document.text)} bytes).`, 300),
      clamp(`It references ${requires} required modules and ${functions} function-ish tokens.`, 300),
      clamp(`It carries ${markers} TODO/FIXME/HACK markers.`, 300),
    ],
    evidence: [
      clamp(`sha256 prefix ${document.sha256.slice(0, 16)} as supplied by the host collector.`, 300),
      clamp(`Longest line: ${longest} characters.`, 300),
    ],
    // Textual facts are certain; the fixed sub-1.0 value signals "no semantic
    // confidence claimed" to downstream consumers.
    confidence: 0.99,
  };
}

/**
 * Provider factory. The returned object satisfies the registry's provider
 * contract: execute(request) -> { text, usage, costUsd, rawStopReason }.
 */
function createDeterministicProvider() {
  return {
    async execute({ prompt, label }) {
      const documents = extractDocuments(prompt);
      if (documents.length === 0) {
        // Same failure shape a malformed worker response produces: strict
        // JSON parsing at the coordinator rejects it and records a retryable
        // failure — the provider never invents an analysis for missing input.
        return { text: 'no DOCUMENT sections found in prompt', usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
      }
      const analysis = analyzeDocument(documents[0]);
      return {
        text: JSON.stringify(analysis),
        usage: { input_tokens: 0, output_tokens: 0 },
        costUsd: 0,
        rawStopReason: 'end_turn',
        deterministic: true,
        requestFingerprint: crypto.createHash('sha256').update(String(label) + prompt).digest('hex').slice(0, 16),
      };
    },
  };
}

module.exports = { analyzeDocument, createDeterministicProvider, extractDocuments };
