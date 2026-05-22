'use strict';

const fs = require('fs');
const { buildSystem, buildUserMessage } = require('./context-builder');
const modelClient = require('./model-client');
const { getDefinitions, execute, executeForce } = require('./tool-registry');
const { Transcript } = require('./transcript');
const confirm = require('./confirmation');
const safety = require('./safety');
const { CATEGORIES } = require('./permissions');
const { HumanLog } = require('./human-log');
const {
  JsonlTrace,
  bodySummary,
  bytes,
  defaultRunnerTracePath,
  headerSummary,
  makeTraceId,
  normalizeTraceLevel,
} = require('../trace-utils');

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

function applyCacheControlBudget(system, tools) {
  const cachedSystem =
    typeof system === 'string'
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system.map((block) => ({ ...block, cache_control: { type: 'ephemeral' } }));

  return { cachedSystem, cachedTools: tools };
}

function loadMessagesFromTranscript(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const events = lines.map((l) => JSON.parse(l));
  const messages = [];
  let isFirstUser = true;
  for (const ev of events) {
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

async function run(options) {
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
  };
  const cwdCheck = safety.validateCwd(ctx.cwd);
  if (!cwdCheck.valid) {
    console.error('[runner] ' + cwdCheck.reason);
    process.exitCode = 1;
    return;
  }
  ctx.cwdRealpath = cwdCheck.realpath;

  const transcript = transcriptPath ? new Transcript(transcriptPath) : null;
  const humanLog = humanLogPath ? new HumanLog(humanLogPath) : null;
  const output = makeOutput(outputFormat);
  const startedAt = Date.now();
  const normalizedTraceLevel = normalizeTraceLevel(traceLevel);
  const runId = makeTraceId(options.runId);
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

  let messages;
  if (resume && transcriptPath) {
    const loaded = loadMessagesFromTranscript(transcriptPath);
    if (!loaded || loaded.length === 0) {
      console.error('Could not resume: no valid conversation in transcript.');
      process.exitCode = 1;
      return;
    }
    messages = loaded;
    messages.push(buildUserMessage(prompt, stdinText));
    console.error('[runner] resumed ' + loaded.length + ' messages from ' + transcriptPath);
  } else {
    messages = [buildUserMessage(prompt, stdinText)];
    if (transcript) transcript.append({ type: 'user_prompt', text: prompt });
  }

  const tools = getDefinitions(ctx); // cached — ctx flags don't change across turns
  const system = systemPromptOverride || buildSystem(ctx);
  const steps = maxSteps || DEFAULT_MAX_STEPS;
  let totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let consecutiveToolFailures = 0;

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
    const { cachedSystem, cachedTools } = applyCacheControlBudget(system, tools);

    const requestBody = {
      model,
      max_tokens: maxTokens,
      system: cachedSystem,
      messages,
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
      if (transcript) transcript.append({ type: 'error', step, message: msg });
      if (humanLog) humanLog.writeError(msg);
      if (trace) trace.append('runner_bridge_error', { run_id: runId, turn: step, message: msg });
      console.error(msg);
      if (step < steps && consecutiveToolFailures < MAX_CONSECUTIVE_FAILURES) {
        consecutiveToolFailures++;
        if (!quiet)
          console.error(
            '[runner] retrying after bridge error (' + consecutiveToolFailures + '/' + MAX_CONSECUTIVE_FAILURES + ')',
          );
        continue;
      }
      if (transcript) transcript.flush();
      process.exitCode = 1;
      return;
    }

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
        process.exitCode = 1;
        return {
          finalText: msg,
          steps: step,
          duration_ms: Date.now() - startedAt,
          usage: totalUsage,
          events: output.events,
        };
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
      process.exitCode = 1;
      return {
        finalText: msg,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
      };
    }

    if (toolUses.length === 0) {
      const result = {
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
      return result;
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

    // ── Step A: batched read-only tools ──
    if (readTools.length > 0 && verbose) {
      console.error('[runner] step ' + step + ': executing ' + readTools.length + ' read-only tools as a batch');
    }
    for (const tu of readTools) {
      if (trace) trace.append('tool_requested', traceToolUse(runId, step, tu, trace));
      let result = execute(tu.name, tu.input || {}, ctx, tu.id);
      if (result.needsConfirmation && ctx.plan) {
        result = { ok: true, text: 'Plan mode: would ' + result.proposedAction };
      }
      output.emit('tool_use', { step, tool_use_id: tu.id, name: tu.name, input: tu.input || {} });
      output.emit('tool_result', {
        step,
        tool_use_id: tu.id,
        name: tu.name,
        content: result.text || '',
        is_error: !result.ok,
        bytes: result.bytes,
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

    // ── Step B: write/shell tools serially (with confirmation) ──
    for (const toolUse of writeTools) {
      const toolName = toolUse.name;
      const args = toolUse.input || {};
      const toolUseId = toolUse.id;
      output.emit('tool_use', { step, tool_use_id: toolUseId, name: toolName, input: args });
      if (trace) trace.append('tool_requested', traceToolUse(runId, step, toolUse, trace));
      if (transcript) transcript.append({ type: 'tool_call', step, tool: toolName, args, toolUseId });
      if (verbose)
        console.error('[runner] step ' + step + ': tool_call ' + toolName + '(' + JSON.stringify(args) + ')');

      let result = execute(toolName, args, ctx, toolUseId);

      if (result.needsConfirmation) {
        if (trace)
          trace.append('permission_decision', {
            run_id: runId,
            turn: step,
            tool_use_id: toolUseId,
            tool: toolName,
            decision: 'approval_required',
            proposed_action: trace.capture(result.proposedAction),
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
          if (choice === 'allow') result = executeForce(toolName, args, ctx, toolUseId);
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
  }

  const msg = 'Reached max_steps (' + steps + ') without a final answer.';
  if (transcript) transcript.writeFinal(msg);
  if (humanLog) humanLog.writeError(msg);
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
  return { finalText: msg, steps, duration_ms: Date.now() - startedAt, usage: totalUsage, events: output.events };
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
};
