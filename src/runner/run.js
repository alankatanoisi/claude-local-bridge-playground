'use strict';

const fs = require('fs');
const path = require('path');
const { buildSystem, buildUserMessage, buildRepoContextBlock } = require('./context-builder');
const modelClient = require('./model-client');
const { getDefinitions, execute, executeForce, executeReadOnlyBatch } = require('./tool-registry');
const { Transcript } = require('./transcript');
const confirm = require('./confirmation');
const safety = require('./safety');
const { CATEGORIES } = require('./permissions');
const { HumanLog } = require('./human-log');
const { STOP_REASONS } = require('./kernel/contract');
const { SessionStore, resolveSessionPath } = require('./session-store');
const { applyCompactionLadder, DEFAULT_POLICY } = require('./context-compactor');
const { HookDispatcher } = require('./hooks/hook-dispatcher');
const { runBootstrap } = require('./bootstrap');
const { SessionLedger, makeEffectId } = require('./session-ledger');
const { emitHint } = require('./beginner-hints');
const { buildAutopsy, writeAutopsyFile, detectSemanticCycles, estimateTokensAdvisory } = require('./loop-autopsy');
const { estimateCostUsd } = require('./model-pricing');
const { loadInstructionMemory } = require('./memory/instruction-memory');
const { assertForkAllowed, applyProfileToRunOptions } = require('./agents/registry');
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

const DEFAULT_MAX_STEPS = 16;
const MAX_CONSECUTIVE_FAILURES = 2;
const OUTPUT_FORMATS = new Set(['text', 'json', 'stream-json']);

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
      messages.push({ role: 'user', content: ev.text });
      isFirstUser = false;
      continue;
    }
    if (ev.type === 'assistant' && ev.content) {
      messages.push({ role: 'assistant', content: ev.content });
      continue;
    }
    if (ev.type === 'tool_call' && ev.toolUseId) continue;
    if (ev.type === 'tool_result' && ev.toolUseId) {
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: ev.toolUseId,
            content: ev.ok ? ev.text || '' : 'Tool error: ' + (ev.text || 'unknown'),
          },
        ],
      });
      continue;
    }
  }
  while (messages.length > 0 && messages[messages.length - 1].role !== 'user') messages.pop();
  return messages;
}

// B3: path-disjoint detection over canonicalized paths. Two paths are
// disjoint iff neither is identical to the other and neither is a
// prefix-with-separator of the other (catches parent/child conflicts).
// confinePath returns realpath-anchored absolute paths, so symlink aliasing
// is mostly defused at the source.
function _arePathsDisjoint(paths) {
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i];
      const b = paths[j];
      if (!a || !b) return false;
      if (a === b) return false;
      if (a.startsWith(b + path.sep)) return false;
      if (b.startsWith(a + path.sep)) return false;
    }
  }
  return true;
}

function _groupDisjointWrites(writeTools, ctx) {
  const groups = [];
  let current = [];
  let currentPaths = [];
  for (const tu of writeTools) {
    const args = tu.input || {};
    const canonical = args.path ? safety.confinePath(ctx, args.path) : null;
    if (!canonical) {
      if (current.length) {
        groups.push(current);
        current = [];
        currentPaths = [];
      }
      groups.push([tu]);
      continue;
    }
    const candidatePaths = [...currentPaths, canonical];
    if (_arePathsDisjoint(candidatePaths)) {
      current.push(tu);
      currentPaths.push(canonical);
    } else {
      if (current.length) groups.push(current);
      current = [tu];
      currentPaths = [canonical];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function persistSession(sessionStore, messages, ctx) {
  if (!sessionStore) return;
  sessionStore.setMessages(messages);
  sessionStore.updateRunner({
    undoLog: ctx.undoLog || [],
    consecutiveToolFailures: ctx._consecutiveToolFailures || 0,
  });
  sessionStore.saveSoon();
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
  if (options.agentProfile) {
    options = applyProfileToRunOptions(options.agentProfile, options);
  }
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
    trustedWorkspace,
    chaosOk,
    maxWallClockMs,
    maxCostUsd,
    spawnDepth,
    sessionExtract,
    skipTrustGate,
    noArchive,
  } = options;
  const outputFormat = OUTPUT_FORMATS.has(options.outputFormat) ? options.outputFormat : 'text';

  const ctx = {
    cwd: cwd || process.cwd(),
    acceptEdits: !!acceptEdits,
    dontAsk: !!dontAsk,
    allowShell: !!allowShell,
    shellTimeout: shellTimeout || 30000,
    plan: !!plan,
    noNetwork: !!noNetwork,
    confirmTimeout: typeof confirmTimeout === 'number' && confirmTimeout > 0 ? confirmTimeout : null,
    allowedTools: Array.isArray(allowedTools) && allowedTools.length > 0 ? new Set(allowedTools) : null,
    undoLog: [],
    spawnDepth: spawnDepth || 0,
    workspaceTrusted: false,
  };

  if (!skipTrustGate && process.env.BRIDGE_RUNNER_TEST !== '1') {
    const boot = await runBootstrap({
      cwd: cwd || process.cwd(),
      allowShell: !!allowShell,
      acceptEdits: !!acceptEdits,
      dontAsk: !!dontAsk,
      chaosOk: !!chaosOk,
      trustWorkspace: !!trustWorkspace,
      trustedWorkspace: !!trustedWorkspace,
      quiet: !!quiet,
      sessionPath,
      sessionId,
      resume: !!resume,
      systemPromptOverride,
      allowedTools,
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
    ctx.trustedWorkspace = boot.ctx.trustedWorkspace;
  } else {
    const cwdCheck = safety.validateCwd(ctx.cwd);
    if (!cwdCheck.valid) {
      emitHint(cwdCheck.reason, { quiet, verbose, stopReason: STOP_REASONS.CWD_INVALID });
      process.exitCode = 1;
      return;
    }
    ctx.cwdRealpath = cwdCheck.realpath;
    ctx.instructionMemory = loadInstructionMemory(ctx.cwdRealpath);
  }

  try {
    assertForkAllowed(ctx.spawnDepth);
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
  const hooks = new HookDispatcher(ctx.cwdRealpath, {
    trustedWorkspace: !!options.trustedWorkspace,
    workspaceTrusted: ctx.workspaceTrusted,
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
      agentProfile: options.agentProfile,
      transcriptPath,
      tracePath: trace?.filePath || null,
      sessionPath: resolvedSessionPath,
      ledgerPath: ledger?.filePath || null,
      startedAt: new Date(startedAt).toISOString(),
    });
    archiveCollector.recordUser(prompt, stdinText);
  }

  function completeRun(result) {
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
    return result;
  }

  let messages;
  if (resume && sessionStore && sessionStore.exists()) {
    sessionStore.load();
    messages = sessionStore.messages.length ? [...sessionStore.messages] : null;
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
    messages = [buildUserMessage(prompt, stdinText)];
    if (transcript) transcript.append({ type: 'user_prompt', text: prompt });
    if (sessionStore) {
      sessionStore.load();
      sessionStore.setMessages(messages);
      sessionStore.updateMetadata({ cwd: ctx.cwdRealpath, model });
      sessionStore.save();
    }
  }

  const tools = getDefinitions(ctx);
  const system = systemPromptOverride || buildSystem(ctx, { progressive: true });
  // E1: session-stable repo-context block; computed once, reused as the
  // fourth cache_control breakpoint for the lifetime of this run.
  const repoContextBlock = buildRepoContextBlock(ctx);
  const steps = maxSteps || DEFAULT_MAX_STEPS;
  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let consecutiveToolFailures = 0;
  const toolHistory = [];

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

  for (let step = 1; step <= steps; step++) {
    hooks.dispatch('pre_model_request', { step, runId });

    const compaction = applyCompactionLadder(messages, system, {
      ...DEFAULT_POLICY,
      ...(compactionPolicy || {}),
      compactionGeneration: sessionStore ? sessionStore.data().runner.compactionGeneration : 0,
    });
    if (compaction.changed && sessionStore) {
      sessionStore.updateRunner({ compactionGeneration: compaction.generation });
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
      const hint = emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.BRIDGE_ERROR });
      if (transcript) transcript.append({ type: 'error', step, message: msg });
      if (humanLog) humanLog.writeError(msg, { stopReason: STOP_REASONS.BRIDGE_ERROR });
      if (trace) trace.append('runner_bridge_error', { run_id: runId, turn: step, message: msg });
      output.emit('error', { message: msg, hint: hint ? { whatHappened: hint.whatHappened, tip: hint.tip } : null });
      if (step < steps && consecutiveToolFailures < MAX_CONSECUTIVE_FAILURES) {
        consecutiveToolFailures++;
        if (!quiet)
          console.error(
            '[runner] retrying after bridge error (' + consecutiveToolFailures + '/' + MAX_CONSECUTIVE_FAILURES + ')',
          );
        continue;
      }
      if (transcript) transcript.flush();
      hooks.dispatch('session_end', { runId, stopReason: STOP_REASONS.BRIDGE_ERROR });
      process.exitCode = 1;
      return completeRun({
        stopReason: STOP_REASONS.BRIDGE_ERROR,
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      });
    }

    hooks.dispatch('post_model_response', { step, runId });

    if (archiveCollector) archiveCollector.recordAssistant(step, response);
    if (transcript) transcript.append({ type: 'assistant', step, content: response.content });
    if (humanLog) humanLog.writeAssistant(step, response);
    totalUsage = addUsage(totalUsage, response.usage);
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
        persistSession(sessionStore, messages, { ...ctx, _consecutiveToolFailures: consecutiveToolFailures });
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
    persistSession(sessionStore, messages, { ...ctx, _consecutiveToolFailures: consecutiveToolFailures });
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
      persistSession(sessionStore, messages, { ...ctx, _consecutiveToolFailures: consecutiveToolFailures });
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
      persistSession(sessionStore, messages, { ...ctx, _consecutiveToolFailures: consecutiveToolFailures });
      if (archiveCollector) archiveCollector.recordFinal(text || '');
      return completeRun(result);
    }

    const toolResults = [];

    // Batch read-only tools before write/shell tools. These tools are still
    // synchronous today, so this is ordered batching rather than true parallelism.
    const readTools = [];
    const writeTools = [];
    for (const tu of toolUses) {
      if ((CATEGORIES[tu.name] || '') === 'read-only') readTools.push(tu);
      else writeTools.push(tu);
    }

    // ── Step A: parallel read-only tools ──
    if (readTools.length > 0 && verbose) {
      console.error('[runner] step ' + step + ': executing ' + readTools.length + ' read-only tools in parallel');
    }
    for (const tu of readTools) {
      appendLedger(ledger, hooks, 'tool_effect_intent', {
        runId,
        step,
        tool: tu.name,
        toolUseId: tu.id,
        effectId: makeEffectId(),
      });
      hooks.dispatch('pre_tool', { step, tool: tu.name, toolUseId: tu.id });
    }
    const readBatch = readTools.length > 0 ? await executeReadOnlyBatch(readTools, ctx) : [];
    for (const { toolUse: tu, result } of readBatch) {
      appendLedger(ledger, hooks, 'tool_effect_result', {
        runId,
        step,
        tool: tu.name,
        toolUseId: tu.id,
        ok: result.ok,
      });
      if (trace) trace.append('tool_requested', traceToolUse(runId, step, tu, trace));
      if (result.needsConfirmation && ctx.plan) {
        result.ok = true;
        result.text = 'Plan mode: would ' + result.proposedAction;
      }
      toolHistory.push({ name: tu.name, args: tu.input || {}, ok: result.ok });
      output.emit('tool_use', { step, tool_use_id: tu.id, name: tu.name, input: tu.input || {} });
      output.emit('tool_result', {
        step,
        tool_use_id: tu.id,
        name: tu.name,
        content: result.text || '',
        is_error: !result.ok,
        bytes: result.bytes,
        envelope: result.envelope,
        permission: result.permission,
      });
      if (transcript) {
        transcript.append({ type: 'tool_call', step, tool: tu.name, args: tu.input, toolUseId: tu.id });
        transcript.append({
          type: 'tool_result',
          step,
          tool: tu.name,
          ok: result.ok,
          text: result.text,
          bytes: result.bytes,
          toolUseId: tu.id,
        });
      }
      if (humanLog) humanLog.writeToolResult(step, tu.name, tu.id, result);
      if (trace) trace.append('tool_finished', traceToolResult(runId, step, tu, result, trace));
      if (archiveCollector) archiveCollector.recordTool(step, tu.name, tu.id, tu.input, result);
      hooks.dispatch('post_tool', { step, tool: tu.name, ok: result.ok });
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result.text || '', is_error: !result.ok });
      if (verbose)
        console.error(
          '[runner] step ' +
            step +
            ': tool_result ' +
            tu.name +
            ' ok=' +
            result.ok +
            (result.text ? ' (' + result.text.length + ' chars)' : ''),
        );
    }

    const cycle = detectSemanticCycles(toolHistory);
    if (cycle) {
      const msg = 'Semantic cycle detected: repeated ' + cycle.key;
      emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.SEMANTIC_CYCLE_DETECTED });
      if (ledger)
        appendLedger(ledger, hooks, 'run_stopped', { runId, stopReason: STOP_REASONS.SEMANTIC_CYCLE_DETECTED });
      const autopsy = buildAutopsy({
        toolHistory,
        stopReason: STOP_REASONS.SEMANTIC_CYCLE_DETECTED,
        steps: step,
        usage: totalUsage,
        duration_ms: Date.now() - startedAt,
      });
      if (resolvedSessionPath) writeAutopsyFile(resolvedSessionPath, autopsy);
      process.exitCode = 1;
      if (archiveCollector) archiveCollector.recordError(step, msg);
      return completeRun({
        stopReason: STOP_REASONS.SEMANTIC_CYCLE_DETECTED,
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
        autopsy,
      });
    }

    if (maxWallClockMs && Date.now() - startedAt > maxWallClockMs) {
      const msg = 'Wall clock budget exceeded';
      emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.WALL_CLOCK_BUDGET_EXCEEDED });
      process.exitCode = 1;
      if (archiveCollector) archiveCollector.recordError(step, msg);
      return completeRun({
        stopReason: STOP_REASONS.WALL_CLOCK_BUDGET_EXCEEDED,
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      });
    }

    if (maxCostUsd) {
      const cost = estimateCostUsd(model, totalUsage);
      if (cost > maxCostUsd) {
        const msg = 'Cost budget exceeded (~$' + cost.toFixed(4) + ')';
        emitHint(msg, { quiet, verbose, stopReason: STOP_REASONS.COST_BUDGET_EXCEEDED });
        process.exitCode = 1;
        if (archiveCollector) archiveCollector.recordError(step, msg);
        return completeRun({
          stopReason: STOP_REASONS.COST_BUDGET_EXCEEDED,
          finalText: msg,
          steps: step,
          duration_ms: Date.now() - startedAt,
          usage: totalUsage,
          events: output.events,
        });
      }
    }

    // ── Step B: write/shell tools serially (with confirmation) ──
    // B3: when --accept-edits is on, pre-execute groups of consecutive
    // writes whose canonical paths are disjoint via Promise.all. The serial
    // loop below consumes cached results so ledger / transcript / output
    // events still fire in the model's emitted order.
    const _parallelResults = new Map();
    if (ctx.acceptEdits === true && writeTools.length > 1) {
      const _groups = _groupDisjointWrites(writeTools, ctx);
      for (const _g of _groups) {
        if (_g.length < 2) continue;
        if (ledger) {
          appendLedger(ledger, hooks, 'tool_use_group', {
            runId,
            step,
            toolUseIds: _g.map((t) => t.id),
            tools: _g.map((t) => t.name),
          });
        }
        const _groupResults = await Promise.all(_g.map((tu) => executeForce(tu.name, tu.input || {}, ctx, tu.id)));
        for (let _i = 0; _i < _g.length; _i++) {
          _parallelResults.set(_g[_i].id, _groupResults[_i]);
        }
      }
    }
    for (const toolUse of writeTools) {
      const toolName = toolUse.name;
      const args = toolUse.input || {};
      const toolUseId = toolUse.id;
      const effectId = makeEffectId();
      appendLedger(ledger, hooks, 'tool_effect_intent', { runId, step, tool: toolName, toolUseId, effectId });
      hooks.dispatch('pre_tool', { step, tool: toolName, toolUseId });
      output.emit('tool_use', { step, tool_use_id: toolUseId, name: toolName, input: args });
      if (trace) trace.append('tool_requested', traceToolUse(runId, step, toolUse, trace));
      if (transcript) transcript.append({ type: 'tool_call', step, tool: toolName, args, toolUseId });
      if (verbose)
        console.error('[runner] step ' + step + ': tool_call ' + toolName + '(' + JSON.stringify(args) + ')');

      let result = _parallelResults.has(toolUseId)
        ? _parallelResults.get(toolUseId)
        : await execute(toolName, args, ctx, toolUseId);

      if (result.needsConfirmation) {
        if (trace)
          trace.append('permission_decision', {
            run_id: runId,
            turn: step,
            tool_use_id: toolUseId,
            tool: toolName,
            decision: 'approval_required',
            proposed_action: trace.capture(result.proposedAction),
            permission: result.permission,
          });
        output.emit('approval_required', {
          step,
          tool_use_id: toolUseId,
          name: toolName,
          proposed_action: result.proposedAction,
        });
        if (transcript)
          transcript.append({ type: 'tool_confirm', step, tool: toolName, proposedAction: result.proposedAction });
        if (ctx.plan) {
          result = { ok: true, text: 'Plan mode: would ' + result.proposedAction };
        } else {
          const choice = await confirm.ask(result.proposedAction, ctx.confirmTimeout);
          if (trace)
            trace.append('approval_resolved', {
              run_id: runId,
              turn: step,
              tool_use_id: toolUseId,
              tool: toolName,
              decision: choice,
            });
          if (choice === 'allow') result = await executeForce(toolName, args, ctx, toolUseId);
          else {
            if (transcript) transcript.append({ type: 'tool_denied', step, tool: toolName });
            result = { ok: false, text: 'User denied this action.' };
          }
        }
      }

      if (!result.ok && !result.needsConfirmation) {
        consecutiveToolFailures++;
        if (consecutiveToolFailures >= MAX_CONSECUTIVE_FAILURES) {
          const escalate =
            '\n\n⚠️  ' +
            consecutiveToolFailures +
            ' consecutive tool failures. The runner is stopping to prevent an infinite retry loop. Last failure: ' +
            toolName +
            ' — ' +
            result.text;
          result.text = (result.text || '') + escalate;
          if (transcript)
            transcript.append({ type: 'escalation', step, tool: toolName, failures: consecutiveToolFailures });
          console.error(escalate);
        } else {
          if (!quiet)
            console.error(
              '[runner] tool failure (' +
                consecutiveToolFailures +
                '/' +
                MAX_CONSECUTIVE_FAILURES +
                '): ' +
                toolName +
                ' — ' +
                (result.text || 'unknown error').slice(0, 200),
            );
        }
      } else {
        consecutiveToolFailures = 0;
      }

      if (transcript)
        transcript.append({
          type: 'tool_result',
          step,
          tool: toolName,
          ok: result.ok,
          text: result.text,
          bytes: result.bytes,
          toolUseId,
        });
      if (humanLog) humanLog.writeToolResult(step, toolName, toolUseId, result);
      if (trace) trace.append('tool_finished', traceToolResult(runId, step, toolUse, result, trace));
      if (archiveCollector) archiveCollector.recordTool(step, toolName, toolUseId, args, result);
      appendLedger(ledger, hooks, 'tool_effect_result', {
        runId,
        step,
        tool: toolName,
        toolUseId,
        effectId,
        ok: result.ok,
      });
      hooks.dispatch('post_tool', { step, tool: toolName, ok: result.ok });
      if (verbose)
        console.error(
          '[runner] step ' +
            step +
            ': tool_result ' +
            toolName +
            ' ok=' +
            result.ok +
            (result.text ? ' (' + result.text.length + ' chars)' : ''),
        );
      output.emit('tool_result', {
        step,
        tool_use_id: toolUseId,
        name: toolName,
        content: result.text || '',
        is_error: !result.ok,
        bytes: result.bytes,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: result.text || '',
        is_error: !result.ok,
      });
    }

    messages.push({ role: 'user', content: toolResults });
    persistSession(sessionStore, messages, { ...ctx, _consecutiveToolFailures: consecutiveToolFailures });
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
  persistSession(sessionStore, messages, { ...ctx, _consecutiveToolFailures: consecutiveToolFailures });
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

function traceToolUse(runId, turn, toolUse, trace) {
  return {
    run_id: runId,
    turn,
    tool_use_id: toolUse.id,
    tool: toolUse.name,
    input_bytes: bytes(toolUse.input || {}),
    input: trace.capture(toolUse.input || {}),
  };
}

function traceToolResult(runId, turn, toolUse, result, trace) {
  return {
    run_id: runId,
    turn,
    tool_use_id: toolUse.id,
    tool: toolUse.name,
    ok: !!result.ok,
    bytes: result.bytes,
    result_bytes: bytes(result.text || ''),
    result: trace.capture(result.text || ''),
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
  _arePathsDisjoint,
  _groupDisjointWrites,
};
