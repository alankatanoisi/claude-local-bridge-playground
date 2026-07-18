'use strict';

/**
 * AgentKernel — thin wrapper around run() with a stable contract.
 *
 * Single responsibility: execute one agent run graph deterministically.
 * Orchestration (coordinator, workers) lives above this layer.
 */

const { run } = require('../run');
const { STOP_REASONS, normalizeKernelResult } = require('./contract');

/**
 * Execute the agent kernel once.
 * @param {import('./contract').KernelInput} input
 * @returns {Promise<import('./contract').KernelResult|null>}
 */
async function runKernel(input) {
  const allowedTools =
    input.allowedTools instanceof Set
      ? input.allowedTools
      : Array.isArray(input.allowedTools)
        ? new Set(input.allowedTools)
        : input.allowedTools;

  const options = {
    prompt: input.prompt,
    stdinText: input.stdinText,
    cwd: input.cwd,
    model: input.model,
    maxTokens: input.maxTokens,
    maxSteps: input.maxSteps,
    outputFormat: input.outputFormat || 'text',
    transcriptPath: input.transcriptPath,
    humanLogPath: input.humanLogPath,
    bridgeUrl: input.bridgeUrl,
    callerToken: input.callerToken,
    verbose: input.verbose,
    quiet: input.quiet,
    acceptEdits: input.acceptEdits,
    dontAsk: input.dontAsk,
    allowShell: input.allowShell,
    shellTimeout: input.shellTimeout,
    resume: input.resume,
    stream: input.stream,
    noNetwork: input.noNetwork,
    systemPromptOverride: input.systemPromptOverride,
    plan: input.plan,
    temperature: input.temperature,
    confirmTimeout: input.confirmTimeout,
    allowedTools,
    maxContextTokens: input.maxContextTokens,
    maxToolCallsPerTurn: input.maxToolCallsPerTurn,
    traceLevel: input.traceLevel,
    tracePath: input.tracePath,
    runId: input.runId,
    sessionPath: input.sessionPath,
    sessionId: input.sessionId,
    compactionPolicy: input.compactionPolicy,
    trustWorkspace: input.trustWorkspace,
    trustedWorkspace: input.trustedWorkspace,
    chaosOk: input.chaosOk,
    maxWallClockMs: input.maxWallClockMs,
    maxCostUsd: input.maxCostUsd,
    spawnDepth: input.spawnDepth,
    skipTrustGate: input.skipTrustGate,
    sessionExtract: input.sessionExtract,
    noArchive: input.noArchive,
  };

  const exitCodeBefore = process.exitCode;
  process.exitCode = undefined;

  let raw;
  try {
    raw = await run(options);
  } finally {
    // run() may set process.exitCode; capture for kernel result
  }

  const exitCode = process.exitCode ?? exitCodeBefore ?? (raw ? 0 : 1);

  if (raw === undefined || raw === null) {
    if (exitCode !== 0) {
      return normalizeKernelResult(
        { finalText: '', steps: 0, duration_ms: 0, usage: {}, events: [] },
        { exitCode, stopReason: STOP_REASONS.CWD_INVALID, runId: input.runId },
      );
    }
    return null;
  }

  return normalizeKernelResult(raw, { exitCode, runId: input.runId });
}

module.exports = { runKernel };
