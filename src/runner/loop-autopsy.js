'use strict';

/**
 * Loop autopsy — read-only analysis at run stop (never writes to ledger).
 */

const { privateWriteFileSync } = require('./private-fs');

function normalizeToolCall(toolName, args) {
  return toolName + ':' + JSON.stringify(args || {});
}

function detectSemanticCycles(toolHistory) {
  if (!toolHistory || toolHistory.length < 4) return null;
  const recent = toolHistory.slice(-6).map((t) => normalizeToolCall(t.name, t.args));
  const counts = {};
  for (const key of recent) counts[key] = (counts[key] || 0) + 1;
  for (const [key, n] of Object.entries(counts)) {
    if (n >= 3) return { kind: 'repeated_tool_call', key, count: n };
  }
  return null;
}

/**
 * @param {object} input
 * @param {object[]} input.toolHistory
 * @param {string} input.stopReason
 * @param {number} input.steps
 * @param {object} input.usage
 * @param {number} [input.duration_ms]
 * @returns {object} autopsy report
 */
function buildAutopsy(input) {
  const cycle = detectSemanticCycles(input.toolHistory);
  return {
    stopReason: input.stopReason,
    steps: input.steps,
    duration_ms: input.duration_ms,
    usage: input.usage,
    cycleDetected: !!cycle,
    cycle,
    toolCallCount: (input.toolHistory || []).length,
    generatedAt: new Date().toISOString(),
  };
}

function writeAutopsyFile(sessionPath, autopsy) {
  if (!sessionPath) return null;
  const outPath = sessionPath.replace(/\.state\.json$/, '.autopsy.json');
  privateWriteFileSync(outPath, JSON.stringify(autopsy, null, 2) + '\n');
  return outPath;
}

/** Advisory token estimate — never used alone to block turns. */
function estimateTokensAdvisory(messages) {
  let chars = 0;
  for (const msg of messages || []) {
    if (typeof msg.content === 'string') chars += msg.content.length;
    else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) chars += block.text.length;
        if (block.content) chars += String(block.content).length;
      }
    }
  }
  const codeHeavy = /```|function |const |import /.test(JSON.stringify(messages || []));
  const divisor = codeHeavy ? 2 : 3.5;
  return Math.ceil(chars / divisor);
}

module.exports = {
  normalizeToolCall,
  detectSemanticCycles,
  buildAutopsy,
  writeAutopsyFile,
  estimateTokensAdvisory,
};
