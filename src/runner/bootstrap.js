'use strict';

/**
 * Memoized bootstrap stages for runner startup.
 */

const { evaluateWorkspaceTrust, isTrusted } = require('./workspace-trust');
const safety = require('./safety');
const { loadInstructionMemory } = require('./memory/instruction-memory');
const { getCachedSystemPrompt, setCachedSystemPrompt } = require('./context-budget');
const { resolveSystemPrompt } = require('./system-prompt');
const { resolveContextPolicy } = require('./context-policy');
const { validateChaosCombo } = require('./shell-policy');
const { SessionLedger } = require('./session-ledger');
const { SessionStore, resolveSessionPath } = require('./session-store');
const { replayFromLedger } = require('./replay-simulator');

const STAGES = Object.freeze([
  'parse_cli',
  'validate_cwd',
  'workspace_trust',
  'load_instructions',
  'build_context',
  'resume_session',
  'ready',
]);

async function runBootstrap(input) {
  const result = {
    stagesCompleted: [],
    ctx: {},
    blocked: false,
    blockReason: null,
    stopReason: null,
  };

  // Stage 1: validate cwd
  const cwdCheck = safety.validateCwd(input.cwd || process.cwd());
  if (!cwdCheck.valid) {
    result.blocked = true;
    result.blockReason = cwdCheck.reason;
    result.stopReason = 'cwd_invalid';
    return result;
  }
  result.stagesCompleted.push('validate_cwd');
  result.ctx.cwd = input.cwd;
  result.ctx.cwdRealpath = cwdCheck.realpath;

  // Stage 2: chaos combo check
  const chaos = validateChaosCombo({
    allowShell: !!input.allowShell,
    acceptEdits: !!input.acceptEdits,
    dontAsk: !!input.dontAsk,
    chaosOk: !!input.chaosOk,
  });
  if (!chaos.allowed) {
    result.blocked = true;
    result.blockReason = chaos.reason;
    return result;
  }

  // Stage 3: workspace trust
  const trust = await evaluateWorkspaceTrust({
    cwdRealpath: result.ctx.cwdRealpath,
    trustWorkspace: !!input.trustWorkspace,
    inheritTrust: !!input.inheritTrust,
    quiet: !!input.quiet,
  });
  result.trust = trust;
  if (!trust.trusted) {
    result.blocked = true;
    result.blockReason = 'workspace_not_trusted';
    result.stopReason = 'workspace_not_trusted';
    return result;
  }
  result.ctx.workspaceTrusted = true;
  result.ctx.trustedWorkspace = !!input.trustedWorkspace || isTrusted(result.ctx.cwdRealpath);
  result.stagesCompleted.push('workspace_trust');

  const contextPolicy = resolveContextPolicy(input);

  // Stage 4: instructions (opt-in project markdown)
  const memory = loadInstructionMemory(result.ctx.cwdRealpath, {
    includeProjectDocs: contextPolicy.includeInstructionDocs,
  });
  result.instructionMemory = memory;
  result.ctx.instructionHash = memory.hash;
  result.stagesCompleted.push('load_instructions');

  // Stage 5: context
  const exposed = input.exposedTools || input.allowedTools;
  const ctxForPrompt = {
    cwd: result.ctx.cwdRealpath,
    cwdRealpath: result.ctx.cwdRealpath,
    allowShell: !!input.allowShell,
    allowedTools: exposed && exposed.length ? new Set(exposed) : null,
    instructionHash: memory.hash,
    instructionMemory: memory,
    compactionGeneration: 0,
    trustState: trust.reason,
    autoMemory: !!input.autoMemory,
  };
  let system =
    input.systemPromptOverride || input.systemPromptFile || input.appendSystemPrompt || input.appendSystemPromptFile
      ? null
      : getCachedSystemPrompt(ctxForPrompt);
  if (!system) {
    system = resolveSystemPrompt(ctxForPrompt, {
      progressive: true,
      contextPolicy,
      systemPromptOverride: input.systemPromptOverride,
      systemPromptFile: input.systemPromptFile,
      appendSystemPrompt: input.appendSystemPrompt,
      appendSystemPromptFile: input.appendSystemPromptFile,
    });
    if (!input.systemPromptOverride && !input.systemPromptFile) {
      setCachedSystemPrompt(ctxForPrompt, system);
    }
  }
  result.system = system;
  result.stagesCompleted.push('build_context');

  // Stage 6: resume
  const sessionPath = resolveSessionPath({ sessionPath: input.sessionPath, sessionId: input.sessionId });
  if (sessionPath) {
    const store = new SessionStore(sessionPath);
    store.load();
    result.sessionStore = store;
    result.sessionPath = sessionPath;
    const ledger = new SessionLedger(sessionPath);
    result.ledger = ledger;
    const replay = replayFromLedger(sessionPath);
    result.replay = replay;
    if (input.resume && store.data().messages.length === 0 && !replay.ok) {
      result.blocked = true;
      result.blockReason = 'Could not resume: no valid ledger or session checkpoint.';
      result.stopReason = 'resume_failed';
      return result;
    }
  }
  result.stagesCompleted.push('resume_session');
  result.stagesCompleted.push('ready');
  return result;
}

module.exports = {
  STAGES,
  runBootstrap,
};
