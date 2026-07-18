'use strict';

const fs = require('fs');
const { buildUserMessage, buildRepoContextBlock, buildDynamicEnvironmentBlock } = require('./context-builder');
const { resolveContextPolicy } = require('./context-policy');
const { resolveSystemPrompt } = require('./system-prompt');
const modelClient = require('./model-client');
const { parseRetryAfterSeconds } = modelClient;
const { createToolPipeline, _arePathsDisjoint, _groupDisjointWrites } = require('./tool-pipeline');
const { Transcript } = require('./transcript');
const confirm = require('./confirmation');
const safety = require('./safety');
const { HumanLog } = require('./human-log');
const { STOP_REASONS } = require('./kernel/contract');
const { SessionStore, resolveSessionPath } = require('./session-store');
const { applyCompactionLadder, DEFAULT_POLICY } = require('./context-compactor');
const { assertValidAnthropicMessages, toolUseIds } = require('./message-contract');
const { HookDispatcher } = require('./hooks/hook-dispatcher');
const { runBootstrap } = require('./bootstrap');
const { SessionLedger } = require('./session-ledger');
const { emitHint } = require('./beginner-hints');
const { buildAutopsy, writeAutopsyFile, detectSemanticCycles, estimateTokensAdvisory } = require('./loop-autopsy');
const { estimateCostUsd, summarizeUsage } = require('./model-pricing');
const { loadInstructionMemory } = require('./memory/instruction-memory');
const { isAutoMemoryEnabled } = require('./memory/auto-memory');
const instructionDelta = require('./instruction-delta');
const {
  buildHealth,
  assertResumeAllowed,
  formatFreshSessionTip,
  formatTaskScopeEndTip,
  RECOMMENDATIONS,
} = require('./session-health');
const { computeAllowedTools } = require('./tool-visibility');
const {
  JsonlTrace,
  bodySummary,
  bytes,
  defaultRunnerTracePath,
  headerSummary,
  makeTraceId,
  normalizeTraceLevel,
} = require('../trace-utils');
const { isArchiveEnabled, RunArchiveCollector } = require('./archive/collector');
const { finalizeArchiveExport } = require('./archive/run-exporter');
const { disposeSessions } = require('./lsp/lsp-session');
const { createBudgetTracker } = require('./budget-tracker');
const { writeRunManifest } = require('./recovery/run-manifest');

const DEFAULT_MAX_STEPS = 16;
const MAX_CONSECUTIVE_TOOL_FAILURE_BATCHES = 3;
const MAX_BRIDGE_RETRIES = 2;
// Cap how long we sleep on Retry-After so a hostile/huge header cannot stall
// the runner for minutes during an interactive session.
const MAX_RETRY_AFTER_MS = 30_000;
const VALID_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max']);

function isTransientBridgeError(err) {
  if (!err) return false;
  if (err.retryable === true) return true;
  if (err.retryable === false) return false;
  // Older string-only errors from network paths.
  return /Request error:|timed out|Stream error:|ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(err.message || '');
}

function bridgeRetryDelayMs(err, attempt) {
  if (err && err.name === 'BridgeHttpError' && err.statusCode === 429) {
    const seconds = parseRetryAfterSeconds(err.headers);
    if (seconds !== null && seconds !== undefined) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  // Mild exponential backoff for 5xx / network: 250ms, 500ms, …
  return Math.min(250 * 2 ** Math.max(0, attempt - 1), MAX_RETRY_AFTER_MS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEffort(effort) {
  if (!effort) return null;
  const level = String(effort).toLowerCase();
  if (!VALID_EFFORT_LEVELS.has(level)) {
    throw new Error('--effort must be one of: low, medium, high, max');
  }
  return level;
}
const OUTPUT_FORMATS = new Set(['text', 'json', 'stream-json']);

/**
 * Normalize --tools / allowedTools input. AgentKernel may pass a Set; treating
 * only Array.isArray as valid used to drop the allowlist entirely (P0-08).
 */
function normalizeExposedToolsList(value) {
  if (!value) return null;
  if (value instanceof Set) {
    const list = [...value];
    return list.length > 0 ? list : null;
  }
  if (Array.isArray(value) && value.length > 0) return value;
  return null;
}

function extractTextBlocks(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function extractToolUses(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b.type === 'tool_use');
}

function addUsage(totalUsage, usage) {
  if (!usage) return totalUsage;
  return {
    input_tokens: totalUsage.input_tokens + (usage.input_tokens || 0),
    output_tokens: totalUsage.output_tokens + (usage.output_tokens || 0),
    cache_read_input_tokens: (totalUsage.cache_read_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
    cache_creation_input_tokens:
      (totalUsage.cache_creation_input_tokens || 0) + (usage.cache_creation_input_tokens || 0),
  };
}

function makeOutput(outputFormat) {
  const events = [];
  function emit(type, fields) {
    const event = { type, ...(fields || {}) };
    events.push(event);
    if (outputFormat === 'stream-json') process.stdout.write(JSON.stringify(event) + '\n');
    return event;
  }
  function finish(result) {
    if (outputFormat === 'json') process.stdout.write(JSON.stringify(result) + '\n');
    else if (outputFormat === 'text' && result.finalText && !result.streamed) console.log(result.finalText);
  }
  return { events, emit, finish };
}

// Shared TTL for all runner-side cache_control markers. Must match the bridge
// OAuth path (prependClaudeCodeSystem uses ttl: '1h'). Anthropic rejects mixed
// TTL ordering (e.g. default 5m on tools before 1h on system).
const RUNNER_CACHE_CONTROL = Object.freeze({ type: 'ephemeral', ttl: '1h' });

// Mark cache_control breakpoints so the bridge/Anthropic side can serve a
// prompt-cache read instead of reprocessing the whole prefix every turn.
// Budget: Anthropic allows 4 breakpoints per request. We use up to 3 —
//   1. last block of system prompt
//   2. last tool definition (caches the whole tools array prefix)
//   3. last block of the second-most-recent message (the most recent message
//      is the freshly-appended turn that would invalidate the cache).
//
// We never mutate the inputs: only the touched message is shallow-cloned.
// E1: optional repoContextBlock string occupies the fourth cache breakpoint,
// prepended to the system message and marked separately from the last-block
// breakpoint that already lived there.
// Anthropic allows 4 cache_control markers per request. The OAuth bridge prepends
// a cached identity block (see prependClaudeCodeSystem) — reserve one slot so
// runner + bridge stay within the limit.
const BRIDGE_OAUTH_CACHE_RESERVE = 1;

function applyCacheControlBudget(system, tools, messages, repoContextBlock) {
  let cachedSystem;
  if (repoContextBlock) {
    const repoBlock = { type: 'text', text: repoContextBlock, cache_control: RUNNER_CACHE_CONTROL };
    if (typeof system === 'string') {
      // Repo block is the only runner system marker when E1 is active — a second
      // system breakpoint would exceed 4 once the bridge identity block is added.
      cachedSystem = [repoBlock, { type: 'text', text: system }];
    } else if (Array.isArray(system)) {
      cachedSystem = [repoBlock, ...system];
    } else {
      cachedSystem = [repoBlock];
    }
  } else {
    cachedSystem =
      typeof system === 'string'
        ? [{ type: 'text', text: system, cache_control: RUNNER_CACHE_CONTROL }]
        : markLastBlock(system);
  }

  const cachedTools =
    Array.isArray(tools) && tools.length > 0
      ? tools.map((tool, i, arr) => (i === arr.length - 1 ? { ...tool, cache_control: RUNNER_CACHE_CONTROL } : tool))
      : tools;

  const cachedMessages = Array.isArray(messages) ? markStableTranscriptPrefix(messages) : messages;

  // Anthropic allows up to 4 cache_control markers per request. Throw loud
  // rather than rely on silent server-side eviction if a future change adds
  // a fifth breakpoint without demoting one.
  const used = _countCacheControlBreakpoints(cachedSystem, cachedTools, cachedMessages);
  const maxRunner = 4 - BRIDGE_OAUTH_CACHE_RESERVE;
  if (used > maxRunner) {
    throw new Error(
      'applyCacheControlBudget: ' + used + ' cache_control breakpoints exceeds runner budget of ' + maxRunner,
    );
  }

  return { cachedSystem, cachedTools, cachedMessages };
}

function _countCacheControlBreakpoints(cachedSystem, cachedTools, cachedMessages) {
  let n = 0;
  if (Array.isArray(cachedSystem)) {
    for (const b of cachedSystem) if (b && b.cache_control) n++;
  }
  if (Array.isArray(cachedTools)) {
    for (const t of cachedTools) if (t && t.cache_control) n++;
  }
  if (Array.isArray(cachedMessages)) {
    for (const msg of cachedMessages) {
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) if (b && b.cache_control) n++;
      }
    }
  }
  return n;
}

function markLastBlock(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  return blocks.map((block, i, arr) =>
    i === arr.length - 1 ? { ...block, cache_control: RUNNER_CACHE_CONTROL } : block,
  );
}

// Walk back from the second-to-last message to find one with array content
// we can mark. Skipping the most recent message keeps the cache stable across
// the turn that appends the new tool_result / assistant block.
function markStableTranscriptPrefix(messages) {
  if (messages.length < 2) return messages;
  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i];
    if (!Array.isArray(msg.content) || msg.content.length === 0) continue;
    const cloned = messages.slice();
    cloned[i] = { ...msg, content: markLastBlock(msg.content) };
    return cloned;
  }
  return messages;
}

// C3: when called with `options.ledgerCursor`, stop processing transcript
// lines once we've consumed roughly cursor.seq * 4 events — a conservative
// upper bound on how many transcript events a single ledger entry can produce
// (tool turns emit user_prompt + request + assistant + tool_call + tool_result).
// On missing/corrupt cursor the function falls back to reading the whole file.
function loadMessagesFromTranscript(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  const lines = text.split('\n');
  const cursor = options && options.ledgerCursor ? options.ledgerCursor : null;
  const cursorSeq = cursor && typeof cursor.seq === 'number' && cursor.seq > 0 ? cursor.seq : null;
  const lineCap = cursorSeq ? cursorSeq * 4 : Infinity;

  const messages = [];
  let isFirstUser = true;
  let processed = 0;
  let pendingToolUseIds = null;
  let pendingToolResults = [];

  function flushPendingToolResults() {
    if (pendingToolResults.length > 0) {
      messages.push({ role: 'user', content: pendingToolResults });
    }
    pendingToolUseIds = null;
    pendingToolResults = [];
  }

  for (const line of lines) {
    if (processed >= lineCap) break;
    processed++;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'user_prompt' && isFirstUser) {
      flushPendingToolResults();
      messages.push({ role: 'user', content: ev.text });
      isFirstUser = false;
      continue;
    }
    if (ev.type === 'assistant' && ev.content) {
      flushPendingToolResults();
      messages.push({ role: 'assistant', content: ev.content });
      const ids = toolUseIds(messages[messages.length - 1]);
      pendingToolUseIds = ids.length > 0 ? new Set(ids) : null;
      continue;
    }
    if (ev.type === 'tool_call' && ev.toolUseId) continue;
    if (ev.type === 'tool_result' && ev.toolUseId) {
      const resultBlock = {
        type: 'tool_result',
        tool_use_id: ev.toolUseId,
        content: ev.ok ? ev.text || '' : 'Tool error: ' + (ev.text || 'unknown'),
      };

      if (pendingToolUseIds) {
        pendingToolResults.push(resultBlock);
        const returnedIds = new Set(pendingToolResults.map((block) => block.tool_use_id));
        const complete =
          returnedIds.size === pendingToolUseIds.size && [...pendingToolUseIds].every((id) => returnedIds.has(id));
        if (complete) flushPendingToolResults();
      } else {
        // Preserve an orphan as an orphan. The final request validator will
        // reject it with an exact local diagnostic instead of silently hiding
        // transcript corruption.
        messages.push({ role: 'user', content: [resultBlock] });
      }
      continue;
    }
  }
  flushPendingToolResults();

  // A final prose-only assistant answer is stripped so the resume prompt can
  // continue from the last user turn. An unfinished assistant tool batch stays
  // visible and will be rejected locally rather than replayed ambiguously.
  while (
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    toolUseIds(messages[messages.length - 1]).length === 0
  ) {
    messages.pop();
  }
  return messages;
}

function persistSession(sessionStore, messages, ctx, noSessionPersistence) {
  // Drop a per-run recovery manifest regardless of session persistence. The
  // manifest lives under cwd/.bridge-runner/runs/ and powers `undo last-run`;
  // it must exist even when --no-session-persistence is set, because the user
  // still wants to be able to roll back the files this run touched.
  syncRunManifest(ctx);
  if (!sessionStore || noSessionPersistence) return;
  sessionStore.setMessages(messages);
  const tasks = Array.isArray(ctx.tasks) ? ctx.tasks : [];
  sessionStore.updateRunner({
    undoLog: ctx.undoLog || [],
    consecutiveToolFailures: ctx._consecutiveToolFailures || 0,
    tasks,
    activeTaskIds: tasks.filter((t) => t.status === 'in_progress').map((t) => t.id),
  });
  sessionStore.saveSoon();
}

// Write the run's recovery manifest from the in-memory undo log. Cheap and
// idempotent: it overwrites the manifest with the full undo log each time, so
// calling it at every run-exit branch keeps the manifest complete. No-ops when
// the run made no edits (read-only runs leave nothing to undo).
function syncRunManifest(ctx) {
  if (!ctx || !ctx.runManifestMeta) return;
  try {
    writeRunManifest(ctx.cwdRealpath || ctx.cwd, {
      ...ctx.runManifestMeta,
      undoLog: ctx.undoLog || [],
    });
  } catch {
    // Recovery manifests are best-effort; never let manifest IO fail a run.
  }
}

function hydrateRunnerStateFromSession(ctx, sessionStore) {
  if (!sessionStore) return;
  const runner = sessionStore.data().runner || {};
  if (Array.isArray(runner.tasks)) ctx.tasks = runner.tasks;
  else if (!ctx.tasks) ctx.tasks = [];
  ctx._consecutiveToolFailures = Number.isInteger(runner.consecutiveToolFailures) ? runner.consecutiveToolFailures : 0;
}

function appendLedger(ledger, hooks, type, payload) {
  if (!ledger) return null;
  const ev = ledger.append(type, payload);
  if (hooks && ev) hooks.noteLedgerEvent({ type, seq: ev.seq, ts: ev.ts, ...payload });
  return ev;
}

function maybeRunSessionExtract(sessionExtract, ctx, autopsy, sessionPath) {
  if (!sessionExtract || !ctx.trustedWorkspace || !sessionPath) return null;
  const { queuePromotion } = require('./memory-review');
  return queuePromotion(ctx.cwdRealpath, {
    type: 'reference',
    topicId: 'extract_' + Date.now(),
    body:
      'Proposed session learning (requires --review-memory approval):\n' +
      JSON.stringify(
        {
          stopReason: autopsy?.stopReason,
          steps: autopsy?.steps,
          toolCallCount: autopsy?.toolCallCount,
        },
        null,
        2,
      ),
    source: 'session-extract',
  });
}

async function run(options) {
  const retiredProfileKeys = ['agentProfile', 'toolProfileName', 'toolProfile', 'profileContext'];
  const suppliedRetiredKeys = retiredProfileKeys.filter((key) => options[key] !== undefined && options[key] !== null);
  if (suppliedRetiredKeys.length > 0) {
    throw new Error(
      'Runner profiles are retired. Use explicit flags and --tools/--allowed-tools instead. Unsupported option(s): ' +
        suppliedRetiredKeys.join(', '),
    );
  }
  const contextPolicy = resolveContextPolicy(options);
  options = { ...options, contextPolicy };

  const {
    prompt,
    stdinText,
    cwd,
    model,
    maxTokens,
    maxSteps,
    transcriptPath,
    humanLogPath,
    bridgeUrl,
    verbose,
    quiet,
    acceptEdits,
    dontAsk,
    allowShell,
    shellTimeout,
    resume,
    stream,
    noNetwork,
    systemPromptOverride,
    plan,
    temperature,
    confirmTimeout,
    allowedTools,
    maxContextTokens,
    maxToolCallsPerTurn,
    traceLevel,
    tracePath,
    callerToken,
    sessionPath,
    sessionId,
    compactionPolicy,
    trustWorkspace,
    inheritTrust,
    trustedWorkspace,
    chaosOk,
    maxWallClockMs,
    maxCostUsd,
    budgetInputTokens,
    budgetOutputTokens,
    parentBudgetRemaining,
    spawnDepth,
    sessionExtract,
    skipTrustGate,
    noArchive,
    ackResumeRisk,
    newSession,
    taskScope,
    effort,
    autoMemory,
    systemPromptFile,
    appendSystemPrompt,
    appendSystemPromptFile,
    noSessionPersistence,
    testWatch,
    enableLsp,
  } = options;
  const outputFormat = OUTPUT_FORMATS.has(options.outputFormat) ? options.outputFormat : 'text';

  const exposedToolsList = normalizeExposedToolsList(options.exposedTools) || normalizeExposedToolsList(allowedTools);

  const ctx = {
    cwd: cwd || process.cwd(),
    acceptEdits: !!acceptEdits,
    dontAsk: !!dontAsk,
    allowShell: !!allowShell,
    shellTimeout: shellTimeout || 30000,
    plan: !!plan,
    noNetwork: !!noNetwork,
    confirmTimeout: typeof confirmTimeout === 'number' && confirmTimeout > 0 ? confirmTimeout : null,
    _cliToolAllowlist: exposedToolsList ? new Set(exposedToolsList) : null,
    allowedTools: null,
    contextPolicy,
    undoLog: [],
    tasks: [],
    testWatch: !!testWatch,
    enableLsp: !!enableLsp,
    spawnDepth: spawnDepth ?? (parseInt(process.env.BRIDGE_RUNNER_SPAWN_DEPTH, 10) || 0),
    workspaceTrusted: false,
    autoMemory: isAutoMemoryEnabled({ autoMemory }),
  };

  ctx.allowedTools = computeAllowedTools(ctx);

  // Trust bypass is opt-in via skipTrustGate (tests inject this). Do not treat
  // BRIDGE_RUNNER_TEST as a public production escape hatch (P0-08).
  if (!skipTrustGate) {
    const boot = await runBootstrap({
      cwd: cwd || process.cwd(),
      allowShell: !!allowShell,
      acceptEdits: !!acceptEdits,
      dontAsk: !!dontAsk,
      chaosOk: !!chaosOk,
      trustWorkspace: !!trustWorkspace,
      inheritTrust: !!inheritTrust,
      trustedWorkspace: !!trustedWorkspace,
      quiet: !!quiet,
      sessionPath,
      sessionId,
      resume: !!resume,
      systemPromptOverride,
      systemPromptFile,
      appendSystemPrompt,
      appendSystemPromptFile,
      allowedTools: exposedToolsList,
      exposedTools: exposedToolsList,
      autoMemory,
      ...contextPolicy,
      bare: options.bare,
      includeInstructionDocs: contextPolicy.includeInstructionDocs,
      includeRepoContext: contextPolicy.includeRepoContext,
      includeClaudeMdInRepoContext: contextPolicy.includeClaudeMdInRepoContext,
      includeRepoMap: contextPolicy.includeRepoMap,
      includeSkills: contextPolicy.includeSkills,
      excludeDynamicFromSystem: contextPolicy.excludeDynamicFromSystem,
    });
    if (boot.blocked) {
      const stopReason = boot.stopReason || STOP_REASONS.CWD_INVALID;
      emitHint(boot.blockReason, { quiet, verbose, stopReason });
      process.exitCode = 1;
      return {
        stopReason,
        finalText: boot.blockReason,
        steps: 0,
        duration_ms: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        events: [],
      };
    }
    ctx.cwd = boot.ctx.cwdRealpath;
    ctx.cwdRealpath = boot.ctx.cwdRealpath;
    ctx.workspaceTrusted = boot.ctx.workspaceTrusted;
    ctx.instructionMemory = boot.instructionMemory;
    ctx.instructionHash = boot.instructionMemory?.hash;
    ctx.trustedWorkspace = boot.ctx.trustedWorkspace;
  } else {
    const cwdCheck = safety.validateCwd(ctx.cwd);
    if (!cwdCheck.valid) {
      emitHint(cwdCheck.reason, { quiet, verbose, stopReason: STOP_REASONS.CWD_INVALID });
      process.exitCode = 1;
      return;
    }
    ctx.cwdRealpath = cwdCheck.realpath;
    ctx.instructionMemory = loadInstructionMemory(ctx.cwdRealpath, {
      includeProjectDocs: contextPolicy.includeInstructionDocs,
    });
    ctx.instructionHash = ctx.instructionMemory.hash;
  }

  try {
    if (ctx.spawnDepth > 0) {
      throw new Error('Child agents cannot spawn further children (fork depth exceeded).');
    }
  } catch (err) {
    emitHint(err.message, { quiet, verbose, stopReason: 'fork_depth_exceeded' });
    process.exitCode = 1;
    return {
      stopReason: STOP_REASONS.CANCELLED,
      finalText: err.message,
      steps: 0,
      duration_ms: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      events: [],
    };
  }

  const cwdCheck = safety.validateCwd(ctx.cwd);
  if (!cwdCheck.valid) {
    emitHint(cwdCheck.reason, { quiet, verbose, stopReason: STOP_REASONS.CWD_INVALID });
    process.exitCode = 1;
    return;
  }
  ctx.cwdRealpath = cwdCheck.realpath;

  const runId = makeTraceId(options.runId);
  const archiveEnabled = isArchiveEnabled({ noArchive });
  let archiveCollector = null;
  const resolvedSessionPath = resolveSessionPath({ sessionPath, sessionId });
  const sessionStore = resolvedSessionPath ? new SessionStore(resolvedSessionPath) : null;
  const ledger = resolvedSessionPath ? new SessionLedger(resolvedSessionPath) : null;
  let compactionGeneration = sessionStore ? sessionStore.data().runner.compactionGeneration || 0 : 0;
  ctx.compactionGeneration = compactionGeneration;
  const hooks = new HookDispatcher(ctx.cwdRealpath, {
    trustedWorkspace: !!options.trustedWorkspace,
    workspaceTrusted: ctx.workspaceTrusted,
    ctx,
  });
  if (ledger) {
    appendLedger(ledger, hooks, 'session_started', { runId, cwd: ctx.cwdRealpath });
    const pending = ledger.getPendingIntents();
    if (pending.length && !quiet) {
      emitHint('Recovered from incomplete prior run (' + pending.length + ' pending effects).', {
        quiet,
        verbose,
        stopReason: 'ledger_crash_recovery',
      });
    }
  }
  hooks.dispatch('session_start', { runId: options.runId, cwd: ctx.cwdRealpath });

  const transcript = transcriptPath ? new Transcript(transcriptPath) : null;
  const humanLog = humanLogPath ? new HumanLog(humanLogPath, { verbose, quiet }) : null;
  const output = makeOutput(outputFormat);
  const startedAt = Date.now();
  const inheritedParentBudget =
    parentBudgetRemaining ||
    (process.env.BRIDGE_RUNNER_BUDGET_INPUT_REMAINING || process.env.BRIDGE_RUNNER_BUDGET_OUTPUT_REMAINING
      ? {
          input_tokens: parseInt(process.env.BRIDGE_RUNNER_BUDGET_INPUT_REMAINING, 10) || undefined,
          output_tokens: parseInt(process.env.BRIDGE_RUNNER_BUDGET_OUTPUT_REMAINING, 10) || undefined,
        }
      : null);
  const budgetTracker = createBudgetTracker({
    startedAt,
    budgetInputTokens,
    budgetOutputTokens,
    parentRemaining: inheritedParentBudget,
  });
  ctx.budgetTracker = budgetTracker;
  // Metadata the recovery manifest needs. Keyed by runId (always unique); the
  // session id is recorded too so `undo run <session-id>` can find this run.
  ctx.runManifestMeta = {
    runId,
    sessionId: sessionId || null,
    model,
    startedAt: new Date(startedAt).toISOString(),
  };
  const normalizedTraceLevel = normalizeTraceLevel(traceLevel);
  const trace =
    normalizedTraceLevel === 'off'
      ? null
      : new JsonlTrace({
          filePath: tracePath || defaultRunnerTracePath(runId),
          level: normalizedTraceLevel,
          traceId: runId,
          layer: 'runner',
        });
  if (trace && !quiet) console.error('[runner] flight recorder: ' + trace.filePath);

  if (archiveEnabled) {
    archiveCollector = new RunArchiveCollector({
      runId,
      sessionId: sessionId || null,
      cwd: ctx.cwdRealpath,
      model,
      prompt,
      stdinText,
      flags: {
        allowShell: ctx.allowShell,
        acceptEdits: ctx.acceptEdits,
        dontAsk: ctx.dontAsk,
        plan: ctx.plan,
        noNetwork: ctx.noNetwork,
      },
      transcriptPath,
      tracePath: trace?.filePath || null,
      sessionPath: resolvedSessionPath,
      ledgerPath: ledger?.filePath || null,
      startedAt: new Date(startedAt).toISOString(),
    });
    archiveCollector.recordUser(prompt, stdinText);
  }

  // The tool pipeline owns everything between "the model emitted tool_use
  // blocks" and "completed, recorded tool results exist" — see CONTEXT.md
  // and src/runner/tool-pipeline.js. Constructed once per run; sinks and the
  // confirm port are fixed for the run's lifetime.
  const pipeline = createToolPipeline({
    ctx,
    runId,
    confirm,
    sinks: { ledger, hooks, output, trace, transcript, humanLog, archive: archiveCollector },
    verbosity: { verbose, quiet },
    failureLimit: MAX_CONSECUTIVE_TOOL_FAILURE_BATCHES,
  });

  function syncBudgetRemaining(totalUsage) {
    if (!budgetTracker) return;
    const remaining = budgetTracker.remainingAfterUsage(totalUsage);
    ctx.budgetInputRemaining = remaining.input_tokens;
    ctx.budgetOutputRemaining = remaining.output_tokens;
  }

  function emitBudgetBoundary(step, totalUsage) {
    if (!budgetTracker) return null;
    const verdict = budgetTracker.evaluate(totalUsage, ctx);
    output.emit('budget', verdict.event);
    if (trace) trace.append('budget', { run_id: runId, turn: step, ...verdict.event });
    syncBudgetRemaining(totalUsage);
    for (const warning of verdict.warnings || []) {
      if (!quiet) emitHint(warning.message, { quiet, verbose, stopReason: warning.stopReason });
      output.emit('budget_warning', { step, kind: warning.kind, message: warning.message });
    }
    if (verdict.stop) {
      return { stop: verdict.stop, message: verdict.message };
    }
    return null;
  }

  function completeRun(result) {
    disposeSessions(ctx);
    // Single owner of end-of-run usage/cost output: stderr (default, suppressed
    // under quiet), transcript, and human-log. Routing it here covers every
    // terminal path (success, budget, error) with one site. stdout is left
    // untouched so the final answer stays clean/pipeable.
    const usageSummary = summarizeUsage(model, result.usage);
    if (!quiet) {
      console.error(usageSummary.oneLine);
      if (verbose) {
        console.error('[runner usage]   model: ' + (usageSummary.model || 'unknown'));
        console.error(
          '[runner usage]   input ' +
            usageSummary.inputTokens +
            ' / output ' +
            usageSummary.outputTokens +
            ' / cache_read ' +
            usageSummary.cacheReadTokens +
            ' / cache_write ' +
            usageSummary.cacheCreationTokens,
        );
        console.error(
          '[runner usage]   cache read share ' +
            Math.round(usageSummary.cacheReadShare * 100) +
            '% / estimated cost ~$' +
            usageSummary.costUsd.toFixed(4),
        );
      }
    }
    if (transcript) transcript.recordUsage(usageSummary);
    if (humanLog) humanLog.writeUsage(usageSummary);
    if (sessionStore && result.stopReason) {
      const runner = sessionStore.data().runner || {};
      const health = buildHealth({
        stopReason: result.stopReason,
        autopsy: result.autopsy,
        compactionGeneration: runner.compactionGeneration || 0,
        consecutiveToolFailures: pipeline.failureStreak,
      });
      sessionStore.updateRunner({ health });
    }
    if (sessionStore) {
      try {
        sessionStore.flushSync();
      } catch {
        // best-effort durability
      }
    }
    if (ledger) {
      try {
        ledger.close();
      } catch {
        // best-effort fd release
      }
    }
    if (archiveCollector) {
      try {
        finalizeArchiveExport(archiveCollector, {
          stopReason: result.stopReason,
          finalText: result.finalText,
          steps: result.steps,
          duration_ms: result.duration_ms,
          usage: result.usage,
          estimatedCostUsd: estimateCostUsd(model, result.usage),
          transcriptPath: transcript?.filePath,
          tracePath: trace?.filePath,
          sessionPath: resolvedSessionPath,
          ledgerPath: ledger?.filePath || null,
        });
      } catch (err) {
        if (!quiet) console.error('[runner archive] export failed: ' + err.message);
      }
    }
    if (!quiet && sessionStore) {
      const health = sessionStore.data().runner?.health;
      if (taskScope && result.stopReason === STOP_REASONS.SUCCESS) {
        console.error('[runner tip] ' + formatTaskScopeEndTip());
      } else if (health?.recommendation === RECOMMENDATIONS.FRESH_SESSION) {
        emitHint('Fresh session recommended for the next task.', {
          quiet,
          verbose,
          stopReason: 'fresh_session_recommended',
        });
        console.error('[runner tip] ' + formatFreshSessionTip(sessionId || null));
      }
    }
    return result;
  }

  let messages;
  if (resume && sessionStore && sessionStore.exists()) {
    sessionStore.load();
    hydrateRunnerStateFromSession(ctx, sessionStore);
    const resumeCheck = assertResumeAllowed(sessionStore, { ackResumeRisk: !!ackResumeRisk });
    if (!resumeCheck.allowed) {
      emitHint(resumeCheck.message, { quiet, verbose, stopReason: 'resume_degraded' });
      process.exitCode = 1;
      return completeRun({
        stopReason: STOP_REASONS.RESUME_FAILED,
        finalText: resumeCheck.message,
        steps: 0,
        duration_ms: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        events: [],
      });
    }
    messages = sessionStore.messages.length ? [...sessionStore.messages] : null;
    pipeline.restoreFailureStreak(ctx._consecutiveToolFailures);
    if (!messages || messages.length === 0) {
      emitHint('Could not resume: no valid ledger or session checkpoint.', {
        quiet,
        verbose,
        stopReason: STOP_REASONS.RESUME_FAILED,
      });
      process.exitCode = 1;
      return completeRun({
        stopReason: STOP_REASONS.RESUME_FAILED,
        finalText: 'Could not resume: no valid ledger or session checkpoint.',
        steps: 0,
        duration_ms: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        events: [],
      });
    }
    messages.push(buildUserMessage(prompt, stdinText));
    if (!quiet) console.error('[runner] resumed ' + messages.length + ' messages from session ' + resolvedSessionPath);
    if (sessionStore && !noSessionPersistence) {
      sessionStore.setMessages(messages);
      sessionStore.saveSoon();
    }
  } else if (resume && transcriptPath) {
    emitHint('Transcript resume is deprecated. Use --session-id or --session-path.', {
      quiet,
      verbose,
      stopReason: STOP_REASONS.RESUME_FAILED,
    });
    process.exitCode = 1;
    return completeRun({
      stopReason: STOP_REASONS.RESUME_FAILED,
      finalText: 'Transcript resume is deprecated. Use session store.',
      steps: 0,
      duration_ms: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      events: [],
    });
  } else {
    const userEnvPrefix = [];
    if (contextPolicy.excludeDynamicFromSystem) {
      const envBlock = buildDynamicEnvironmentBlock(ctx);
      if (envBlock) userEnvPrefix.push(envBlock);
    }
    messages = [buildUserMessage(prompt, stdinText, userEnvPrefix.length ? userEnvPrefix : null)];
    if (transcript) transcript.append({ type: 'user_prompt', text: prompt });
    if (sessionStore && !noSessionPersistence) {
      sessionStore.load();
      hydrateRunnerStateFromSession(ctx, sessionStore);
      if (newSession) {
        sessionStore.updateRunner({ health: null, compactionGeneration: 0, consecutiveToolFailures: 0 });
        ctx._consecutiveToolFailures = 0;
      }
      pipeline.restoreFailureStreak(ctx._consecutiveToolFailures);
      sessionStore.setMessages(messages);
      sessionStore.updateMetadata({ cwd: ctx.cwdRealpath, model });
      sessionStore.save();
    }
  }

  instructionDelta.snapshot(ctx.cwdRealpath);

  const tools = pipeline.toolDefinitions();
  let system = resolveSystemPrompt(ctx, {
    progressive: true,
    contextPolicy,
    systemPromptOverride,
    systemPromptFile,
    appendSystemPrompt,
    appendSystemPromptFile,
  });
  const repoContextBlock = buildRepoContextBlock(ctx, contextPolicy);
  const steps = maxSteps || DEFAULT_MAX_STEPS;
  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const toolHistory = [];
  const effortLevel = normalizeEffort(effort);

  if (taskScope && !quiet && !plan) {
    console.error('[runner] tip: --task-scope runs work best with --plan for the first pass.');
  }

  if (ledger) appendLedger(ledger, hooks, 'user_prompt', { runId, prompt: prompt.slice(0, 500) });

  output.emit('system', { subtype: 'init', cwd: ctx.cwdRealpath, model, max_steps: steps });
  if (trace) {
    trace.append('run_started', {
      run_id: runId,
      cwd: ctx.cwdRealpath,
      model,
      max_steps: steps,
      output_format: outputFormat,
      flags: {
        allow_shell: ctx.allowShell,
        accept_edits: ctx.acceptEdits,
        dont_ask: ctx.dontAsk,
        no_network: ctx.noNetwork,
        plan: ctx.plan,
      },
      artifacts: {
        runner_trace: trace.filePath,
        bridge_trace: 'bridge writes ~/.claude-local-bridge/traces/' + runId + '.bridge.jsonl',
      },
      visibility_notes: {
        runner_only: ['cwd validation', 'permission decisions', 'local file and shell effects'],
        bridge_only: ['credential source', 'auth header injection', 'upstream host and forwarded header names'],
        upstream_bound: [
          'Anthropic Messages body after bridge transformation',
          'upstream auth and fingerprint headers',
        ],
      },
    });
    trace.append('runner_context_prepared', {
      run_id: runId,
      prompt_bytes: bytes(prompt || ''),
      stdin_bytes: bytes(stdinText || ''),
      messages_count: messages.length,
      system_bytes: bytes(system),
      tools: tools.map((tool) => tool.name),
      prompt: trace.capture(prompt || ''),
      stdin_text: trace.capture(stdinText || ''),
    });
  }
  if (humanLog) {
    humanLog.writeRunStart({ cwd: ctx.cwdRealpath, model, maxSteps: steps, outputFormat });
    humanLog.writeUserPrompt(prompt, stdinText);
  }

  let bridgeRetryCount = 0;

  for (let step = 1; step <= steps; step++) {
    hooks.dispatch('pre_model_request', { step, runId });

    const instructionChange = instructionDelta.detectChange(ctx.cwdRealpath);
    if (instructionChange?.kind === 'small_diff') {
      messages.push({ role: 'user', content: instructionChange.deltaBlock });
      if (transcript) transcript.append({ type: 'instruction_delta', step, kind: 'small_diff' });
    } else if (instructionChange?.kind === 'large_rewrite') {
      ctx.instructionMemory = loadInstructionMemory(ctx.cwdRealpath, {
        includeProjectDocs: contextPolicy.includeInstructionDocs,
      });
      ctx.instructionHash = ctx.instructionMemory.hash;
      system = resolveSystemPrompt(ctx, {
        progressive: true,
        contextPolicy,
        systemPromptOverride,
        systemPromptFile,
        appendSystemPrompt,
        appendSystemPromptFile,
      });
      if (transcript) transcript.append({ type: 'instruction_delta', step, kind: 'large_rewrite' });
    }

    const compaction = applyCompactionLadder(messages, system, {
      ...DEFAULT_POLICY,
      ...(compactionPolicy || {}),
      compactionGeneration,
    });
    if (compaction.changed) {
      compactionGeneration = compaction.generation;
      ctx.compactionGeneration = compactionGeneration;
      if (sessionStore) sessionStore.updateRunner({ compactionGeneration });
    } else {
      ctx.compactionGeneration = compaction.generation;
    }
    if (compaction.stagesApplied.length) {
      output.emit('compaction', {
        step,
        stages: compaction.stagesApplied,
        tokensEstimated: compaction.tokensEstimated,
      });
      if (ledger) {
        appendLedger(ledger, hooks, 'compaction_applied', {
          runId,
          step,
          stages: compaction.stagesApplied,
          tokensEstimated: compaction.tokensEstimated,
        });
      }
      if (!quiet) {
        emitHint('Compaction applied: ' + compaction.stagesApplied.join(', '), {
          quiet,
          verbose,
          stopReason: 'compaction_applied',
        });
      }
    }
    messages = compaction.messages;
    const systemForRequest = compaction.system;

    const { cachedSystem, cachedTools, cachedMessages } = applyCacheControlBudget(
      systemForRequest,
      tools,
      messages,
      repoContextBlock,
    );

    // The Anthropic Messages API treats an assistant tool-use batch and its
    // following user tool-result batch as one indivisible exchange. Validate
    // the exact payload at the final outbound boundary so compaction, resume,
    // or a future feature cannot accidentally send orphaned or duplicate IDs.
    try {
      assertValidAnthropicMessages(cachedMessages);
    } catch (err) {
      const msg = 'Runner message contract check failed before step ' + step + ': ' + err.message;
      emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.MESSAGE_CONTRACT_ERROR });
      if (transcript) transcript.append({ type: 'error', step, message: msg });
      if (humanLog) humanLog.writeError(msg, { stopReason: STOP_REASONS.MESSAGE_CONTRACT_ERROR });
      if (trace) {
        trace.append('runner_message_contract_error', {
          run_id: runId,
          turn: step,
          message: msg,
          message_count: cachedMessages.length,
        });
      }
      output.emit('error', { message: msg, stop_reason: STOP_REASONS.MESSAGE_CONTRACT_ERROR });
      hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.MESSAGE_CONTRACT_ERROR });
      if (ledger) {
        appendLedger(ledger, hooks, 'run_stopped', {
          runId,
          stopReason: STOP_REASONS.MESSAGE_CONTRACT_ERROR,
        });
      }
      process.exitCode = 1;
      const result = {
        stopReason: STOP_REASONS.MESSAGE_CONTRACT_ERROR,
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      };
      output.finish(result);
      return completeRun(result);
    }

    const advisoryTokens = estimateTokensAdvisory(messages);
    if (maxContextTokens && advisoryTokens > maxContextTokens && !quiet) {
      emitHint('Approaching context budget (~' + advisoryTokens + ' tokens estimated).', {
        quiet,
        verbose,
        stopReason: 'predictive_context_budget_exceeded',
      });
    }

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: cachedSystem,
      messages: cachedMessages,
      tools: cachedTools,
      ...(stream && outputFormat === 'text' ? { stream: true } : {}),
      ...(typeof temperature === 'number' && !isNaN(temperature) ? { temperature } : {}),
      ...(effortLevel ? { output_config: { effort: effortLevel } } : {}),
    };

    if (trace) {
      trace.append('runner_model_request_built', {
        run_id: runId,
        turn: step,
        boundary: 'runner_to_bridge',
        request: bodySummary(requestBody),
        payload: trace.capture(requestBody),
      });
    }
    if (transcript) transcript.append({ type: 'request', step, model });
    output.emit('model_request', { step, model });
    if (verbose) console.error('[runner] step ' + step + ': sending request to bridge');

    let response;
    try {
      if (stream && outputFormat === 'text') {
        response = await modelClient.postStream(requestBody, null, bridgeUrl, {
          streamOutput: true,
          headers: bridgeTraceHeaders(trace, runId, step),
          callerToken,
        });
      } else {
        response = await modelClient.post(requestBody, bridgeUrl, {
          headers: bridgeTraceHeaders(trace, runId, step),
          callerToken,
        });
      }
    } catch (err) {
      const msg = 'Bridge error on step ' + step + ': ' + err.message;
      if (archiveCollector) archiveCollector.recordError(step, msg);
      const hint = emitHint(msg, { quiet, verbose });
      if (transcript) transcript.append({ type: 'error', step, message: msg });
      if (humanLog) humanLog.writeError(msg, { stopReason: STOP_REASONS.BRIDGE_ERROR });
      if (trace) {
        trace.append('runner_bridge_error', {
          run_id: runId,
          turn: step,
          message: msg,
          status_code: typeof err.statusCode === 'number' ? err.statusCode : null,
          retryable: isTransientBridgeError(err),
          bridge_retry_count: bridgeRetryCount,
        });
      }
      output.emit('error', { message: msg, hint: hint ? { whatHappened: hint.whatHappened, tip: hint.tip } : null });
      // Only 429 / 5xx / network failures retry. Deterministic 4xx (401, 400, …)
      // fail once so expired credentials do not burn the retry budget.
      if (step < steps && bridgeRetryCount < MAX_BRIDGE_RETRIES && isTransientBridgeError(err)) {
        bridgeRetryCount++;
        const delayMs = bridgeRetryDelayMs(err, bridgeRetryCount);
        if (!quiet) {
          console.error(
            '[runner] retrying after bridge error (' +
              bridgeRetryCount +
              '/' +
              MAX_BRIDGE_RETRIES +
              ')' +
              (delayMs ? ' in ' + delayMs + 'ms' : ''),
          );
        }
        if (delayMs > 0) await sleep(delayMs);
        continue;
      }
      if (transcript) transcript.flush();
      hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.BRIDGE_ERROR });
      process.exitCode = 1;
      const result = {
        stopReason: STOP_REASONS.BRIDGE_ERROR,
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      };
      output.finish(result);
      return completeRun(result);
    }

    bridgeRetryCount = 0;

    hooks.dispatch('post_model_response', { step, runId });

    if (archiveCollector) archiveCollector.recordAssistant(step, response);
    if (transcript) transcript.append({ type: 'assistant', step, content: response.content });
    if (humanLog) humanLog.writeAssistant(step, response);
    totalUsage = addUsage(totalUsage, response.usage);
    const budgetStopAfterModel = emitBudgetBoundary(step, totalUsage);
    if (budgetStopAfterModel) {
      const { stop, message } = budgetStopAfterModel;
      emitHint(message, { quiet, verbose, stopReason: stop });
      process.exitCode = 1;
      if (transcript) transcript.append({ type: 'error', step, message });
      if (humanLog) humanLog.writeError(message, { stopReason: stop });
      const result = {
        stopReason: stop,
        finalText: message,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      };
      output.emit('error', { message, duration_ms: result.duration_ms, num_turns: step, usage: totalUsage });
      output.finish(result);
      if (trace) trace.append('run_failed', { run_id: runId, ...traceRunResult(result), stop_reason: stop });
      if (ledger) appendLedger(ledger, hooks, 'run_stopped', { runId, stopReason: stop });
      return completeRun(result);
    }
    if (trace) {
      trace.append('runner_model_response_received', {
        run_id: runId,
        turn: step,
        boundary: 'bridge_to_runner',
        response_bytes: bytes(response),
        bridge_response: response._localBridge
          ? { status_code: response._localBridge.status_code, headers: headerSummary(response._localBridge.headers) }
          : null,
        usage: response.usage || {},
        payload: trace.capture(response),
      });
    }
    if (
      verbose &&
      response.usage &&
      (response.usage.cache_read_input_tokens || response.usage.cache_creation_input_tokens)
    ) {
      const parts = [];
      if (response.usage.cache_read_input_tokens)
        parts.push('cache hit ' + response.usage.cache_read_input_tokens + ' tokens');
      if (response.usage.cache_creation_input_tokens)
        parts.push('cache created ' + response.usage.cache_creation_input_tokens + ' tokens');
      console.error('[runner] step ' + step + ': ' + parts.join(', '));
    }

    // Context token budget check
    if (maxContextTokens) {
      const contextTokens = totalUsage.input_tokens + totalUsage.output_tokens;
      if (contextTokens > maxContextTokens * 2) {
        const msg =
          'Context token budget exceeded (2x ' +
          maxContextTokens +
          '). Stopping to prevent runaway costs. Use --max-steps 1 to force an answer or --continue to resume from transcript.';
        if (transcript) transcript.append({ type: 'error', step, message: msg });
        if (humanLog) humanLog.writeError(msg);
        console.error('[runner] ' + msg);
        output.emit('error', { message: msg, duration_ms: Date.now() - startedAt, num_turns: step, usage: totalUsage });
        output.finish({
          finalText: msg,
          steps: step,
          duration_ms: Date.now() - startedAt,
          usage: totalUsage,
          events: output.events,
        });
        if (transcript) transcript.flush();
        persistSession(
          sessionStore,
          messages,
          { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
          !!noSessionPersistence,
        );
        hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.CONTEXT_BUDGET_EXCEEDED });
        process.exitCode = 1;
        if (archiveCollector) archiveCollector.recordError(step, msg);
        return completeRun({
          stopReason: STOP_REASONS.CONTEXT_BUDGET_EXCEEDED,
          finalText: msg,
          steps: step,
          duration_ms: Date.now() - startedAt,
          usage: totalUsage,
          events: output.events,
        });
      }
      if (contextTokens > maxContextTokens) {
        if (!quiet)
          console.error(
            '[runner] step ' +
              step +
              ': context tokens ' +
              contextTokens +
              ' / ' +
              maxContextTokens +
              ' budget (warning)',
          );
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    persistSession(
      sessionStore,
      messages,
      { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
      !!noSessionPersistence,
    );
    output.emit('assistant', {
      step,
      message: {
        id: response.id,
        role: response.role || 'assistant',
        content: response.content,
        usage: response.usage,
      },
    });

    const text = extractTextBlocks(response.content);
    if (text && verbose) console.error('[runner] step ' + step + ': assistant text (' + text.length + ' chars)');
    const toolUses = extractToolUses(response.content);

    // Tool call per-turn cap
    if (maxToolCallsPerTurn && toolUses.length > maxToolCallsPerTurn) {
      const msg =
        'Tool call limit exceeded (' +
        toolUses.length +
        ' > ' +
        maxToolCallsPerTurn +
        '). Stopping to prevent runaway tool use.';
      if (transcript) transcript.append({ type: 'error', step, message: msg });
      if (humanLog) humanLog.writeError(msg);
      console.error('[runner] ' + msg);
      output.emit('error', { message: msg, duration_ms: Date.now() - startedAt, num_turns: step, usage: totalUsage });
      output.finish({
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      });
      if (transcript) transcript.flush();
      persistSession(
        sessionStore,
        messages,
        { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
        !!noSessionPersistence,
      );
      hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.MAX_TOOL_CALLS_PER_TURN });
      process.exitCode = 1;
      if (archiveCollector) archiveCollector.recordError(step, msg);
      return completeRun({
        stopReason: STOP_REASONS.MAX_TOOL_CALLS_PER_TURN,
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      });
    }

    if (toolUses.length === 0) {
      const result = {
        stopReason: STOP_REASONS.SUCCESS,
        finalText: text,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
        streamed: stream && outputFormat === 'text',
      };
      if (transcript) transcript.writeFinal(text || '');
      if (humanLog) humanLog.writeFinal(text || '');
      output.emit('result', {
        subtype: 'success',
        duration_ms: result.duration_ms,
        num_turns: step,
        usage: totalUsage,
      });
      output.finish(result);
      if (trace) trace.append('run_completed', { run_id: runId, ...traceRunResult(result) });
      hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.SUCCESS });
      if (ledger) appendLedger(ledger, hooks, 'run_stopped', { runId, stopReason: STOP_REASONS.SUCCESS });
      const autopsy = buildAutopsy({
        toolHistory,
        stopReason: STOP_REASONS.SUCCESS,
        steps: step,
        usage: totalUsage,
        duration_ms: result.duration_ms,
      });
      if (resolvedSessionPath) writeAutopsyFile(resolvedSessionPath, autopsy);
      maybeRunSessionExtract(sessionExtract, ctx, autopsy, resolvedSessionPath);
      result.autopsy = autopsy;
      persistSession(
        sessionStore,
        messages,
        { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
        !!noSessionPersistence,
      );
      if (archiveCollector) archiveCollector.recordFinal(text || '');
      return completeRun(result);
    }

    const turn = await pipeline.executeTurn(step, toolUses, {
      // Loop-level stops (semantic cycles, wall-clock, cost) fire once per
      // turn — after the read batch is recorded, before any write executes.
      midTurnCheck: (readOutcomes) => {
        for (const o of readOutcomes) {
          toolHistory.push({ name: o.toolUse.name, args: o.toolUse.input || {}, ok: o.result.ok });
        }
        const cycle = detectSemanticCycles(toolHistory);
        if (cycle) {
          return {
            stop: STOP_REASONS.SEMANTIC_CYCLE_DETECTED,
            message: 'Semantic cycle detected: repeated ' + cycle.key,
          };
        }
        if (maxWallClockMs && Date.now() - startedAt > maxWallClockMs) {
          return { stop: STOP_REASONS.WALL_CLOCK_BUDGET_EXCEEDED, message: 'Wall clock budget exceeded' };
        }
        if (maxCostUsd) {
          const cost = estimateCostUsd(model, totalUsage);
          if (cost > maxCostUsd) {
            return {
              stop: STOP_REASONS.COST_BUDGET_EXCEEDED,
              message: 'Cost budget exceeded (~$' + cost.toFixed(4) + ')',
            };
          }
        }
        const budgetStop = emitBudgetBoundary(step, totalUsage);
        if (budgetStop) return budgetStop;
        return null;
      },
    });

    emitBudgetBoundary(step, totalUsage);

    if (turn.aborted) {
      const { reason, message } = turn.aborted;
      emitHint(message, { quiet, verbose, stopReason: reason });
      process.exitCode = 1;
      if (archiveCollector) archiveCollector.recordError(step, message);
      const result = {
        stopReason: reason,
        finalText: message,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      };
      if (reason === STOP_REASONS.SEMANTIC_CYCLE_DETECTED) {
        if (ledger) appendLedger(ledger, hooks, 'run_stopped', { runId, stopReason: reason });
        const autopsy = buildAutopsy({
          toolHistory,
          stopReason: reason,
          steps: step,
          usage: totalUsage,
          duration_ms: result.duration_ms,
        });
        if (resolvedSessionPath) writeAutopsyFile(resolvedSessionPath, autopsy);
        result.autopsy = autopsy;
      }
      return completeRun(result);
    }
    const resultMessage = { role: 'user', content: turn.toolResults };
    messages.push(resultMessage);
    persistSession(
      sessionStore,
      messages,
      { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
      !!noSessionPersistence,
    );

    if (turn.needsRecoveryDecision) {
      const decision = await confirm.askToolFailureRecovery(
        { failures: turn.failureStreak, failureSummary: turn.failureSummary },
        ctx.confirmTimeout,
      );
      if (transcript) {
        transcript.append({
          type: 'tool_failure_recovery_decision',
          step,
          failures: turn.failureStreak,
          action: decision.action,
          guidance: decision.guidance || null,
        });
      }
      if (trace) {
        trace.append('tool_failure_recovery_decision', {
          run_id: runId,
          turn: step,
          failures: turn.failureStreak,
          action: decision.action,
          guidance: decision.guidance ? trace.capture(decision.guidance) : null,
        });
      }

      if (decision.action === 'stop') {
        const msg = 'Stopped safely after ' + turn.failureStreak + ' consecutive failed tool batches.';
        emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.TOOL_FAILURE_ESCALATION });
        if (humanLog) humanLog.writeError(msg, { stopReason: STOP_REASONS.TOOL_FAILURE_ESCALATION });
        output.emit('error', { message: msg, stop_reason: STOP_REASONS.TOOL_FAILURE_ESCALATION });
        hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.TOOL_FAILURE_ESCALATION });
        if (ledger) {
          appendLedger(ledger, hooks, 'run_stopped', {
            runId,
            stopReason: STOP_REASONS.TOOL_FAILURE_ESCALATION,
          });
        }
        process.exitCode = 1;
        const result = {
          stopReason: STOP_REASONS.TOOL_FAILURE_ESCALATION,
          finalText: msg,
          steps: step,
          duration_ms: Date.now() - startedAt,
          usage: totalUsage,
          events: output.events,
        };
        output.finish(result);
        return completeRun(result);
      }

      const recoveryText =
        decision.action === 'guide'
          ? 'Tool recovery guidance from the user: ' + decision.guidance
          : 'Tool recovery decision: continue. Reassess the failures, change the approach or inputs, and do not blindly repeat the same failed calls.';
      resultMessage.content.push({ type: 'text', text: recoveryText });
      pipeline.resetFailureStreak();
      persistSession(
        sessionStore,
        messages,
        { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
        !!noSessionPersistence,
      );
    }
  }

  const msg = 'Reached max_steps (' + steps + ') without a final answer.';
  emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.MAX_STEPS });
  if (transcript) transcript.writeFinal(msg);
  if (humanLog) humanLog.writeError(msg, { stopReason: STOP_REASONS.MAX_STEPS });
  output.emit('error', { message: msg, duration_ms: Date.now() - startedAt, num_turns: steps, usage: totalUsage });
  output.finish({
    finalText: msg,
    steps,
    duration_ms: Date.now() - startedAt,
    usage: totalUsage,
    events: output.events,
  });
  process.exitCode = 1;
  if (trace)
    trace.append('run_failed', {
      run_id: runId,
      final_text: trace.capture(msg),
      steps,
      duration_ms: Date.now() - startedAt,
      usage: totalUsage,
    });
  hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.MAX_STEPS });
  appendLedger(ledger, hooks, 'run_stopped', { runId, stopReason: STOP_REASONS.MAX_STEPS });
  const autopsy = buildAutopsy({
    toolHistory,
    stopReason: STOP_REASONS.MAX_STEPS,
    steps,
    usage: totalUsage,
    duration_ms: Date.now() - startedAt,
  });
  if (resolvedSessionPath) writeAutopsyFile(resolvedSessionPath, autopsy);
  persistSession(
    sessionStore,
    messages,
    { ...ctx, _consecutiveToolFailures: pipeline.failureStreak },
    !!noSessionPersistence,
  );
  if (archiveCollector) archiveCollector.recordError(steps, msg);
  return completeRun({
    stopReason: STOP_REASONS.MAX_STEPS,
    finalText: msg,
    steps,
    duration_ms: Date.now() - startedAt,
    usage: totalUsage,
    events: output.events,
    autopsy,
  });
}

function bridgeTraceHeaders(trace, runId, turn) {
  if (!trace) return {};
  return {
    'x-local-bridge-trace-id': runId,
    'x-local-bridge-run-id': runId,
    'x-local-bridge-trace-turn': String(turn),
    'x-local-bridge-trace-level': trace.level,
  };
}

function traceRunResult(result) {
  return {
    steps: result.steps,
    duration_ms: result.duration_ms,
    usage: result.usage,
    final_text_bytes: bytes(result.finalText || ''),
  };
}

module.exports = {
  run,
  extractTextBlocks,
  extractToolUses,
  loadMessagesFromTranscript,
  applyCacheControlBudget,
  addUsage,
  normalizeEffort,
  isTransientBridgeError,
  bridgeRetryDelayMs,
  normalizeExposedToolsList,
  // Re-exported from tool-pipeline for existing callers/tests.
  _arePathsDisjoint,
  _groupDisjointWrites,
};
