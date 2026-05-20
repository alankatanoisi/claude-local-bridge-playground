'use strict';

/**
 * run.js — Main agent loop with write/edit confirmation and shell support.
 *
 * Features:
 *   - Tool-use loop with category-based permission gating
 *   - Interactive confirmation for write/shell tools
 *   - Opt-in streaming output (--stream)
 *   - Session resume from transcript (--resume <path>)
 *   - Retry/escalation: tool failures are retried once; repeated failures
 *     escalate to user with a warning
 *   - Auto-approve for undo (recovery tool)
 *
 * Steps:
 *   1. Build (or resume) context.
 *   2. POST to bridge with tools definitions.
 *   3. Parse response (buffered or streamed).
 *   4. For write/shell tools: show confirmation prompt.
 *   5. Execute approved tools, send tool_result back.
 *   6. Repeat until final answer or max_steps.
 *   7. Write transcript.
 */

const fs = require('fs');
const { buildSystem, buildUserMessage } = require('./context-builder');
const modelClient = require('./model-client');
const { getDefinitions, execute, executeForce } = require('./tool-registry');
const { Transcript } = require('./transcript');
const confirm = require('./confirmation');
const safety = require('./safety');

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
  };
}

function makeOutput(outputFormat) {
  const events = [];

  function emit(type, fields) {
    const event = { type, ...(fields || {}) };
    events.push(event);
    if (outputFormat === 'stream-json') {
      process.stdout.write(JSON.stringify(event) + '\n');
    }
    return event;
  }

  function finish(result) {
    if (outputFormat === 'json') {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (outputFormat === 'text' && result.finalText && !result.streamed) {
      console.log(result.finalText);
    }
  }

  return { events, emit, finish };
}

// ── Resume: load messages from a transcript JSONL ──

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

    // Reconstruct tool_result user messages from the transcript.
    // We need the tool_use_id — stored in tool_call and tool_result.
    if (ev.type === 'tool_call' && ev.toolUseId) {
      // Tool calls are logged, but we reconstruct them from assistant events
      // (which already contain the tool_use block). So skip standalone tool_call
      // events for message reconstruction.
      continue;
    }

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

  // Remove the last assistant and tool_result pair to allow a fresh response
  // (the user's new prompt will be the next message)
  while (messages.length > 0 && messages[messages.length - 1].role !== 'user') {
    messages.pop();
  }

  return messages;
}

// ── Main run function ──

async function run(options) {
  const {
    prompt,
    stdinText,
    cwd,
    model,
    maxTokens,
    maxSteps,
    transcriptPath,
    bridgeUrl,
    verbose,
    acceptEdits,
    dontAsk,
    allowShell,
    shellTimeout,
    resume,
    stream,
    outputFormat: requestedOutputFormat,
  } = options;

  const outputFormat = OUTPUT_FORMATS.has(requestedOutputFormat) ? requestedOutputFormat : 'text';
  const output = makeOutput(outputFormat);
  const startedAt = Date.now();

  const ctx = {
    cwd: cwd || process.cwd(),
    acceptEdits: !!acceptEdits,
    dontAsk: !!dontAsk,
    allowShell: !!allowShell,
    shellTimeout: shellTimeout || 30000,
    undoLog: [],
  };

  // Validate and realpath-resolve the working directory at startup.
  // This populates ctx.cwdRealpath for confinePath checks downstream.
  const cwdCheck = safety.validateCwd(ctx.cwd);
  if (!cwdCheck.valid) {
    console.error('[runner] ' + cwdCheck.reason);
    process.exitCode = 1;
    return;
  }
  ctx.cwdRealpath = cwdCheck.realpath;

  const transcript = transcriptPath ? new Transcript(transcriptPath) : null;

  // ── Resume: load existing conversation from transcript ──
  let messages;
  if (resume && transcriptPath) {
    const loaded = loadMessagesFromTranscript(transcriptPath);
    if (!loaded || loaded.length === 0) {
      console.error('Could not resume: no valid conversation in transcript.');
      process.exitCode = 1;
      return;
    }
    // Add the new user prompt to the existing conversation
    messages = loaded;
    messages.push(buildUserMessage(prompt, stdinText));
    console.error('[runner] resumed ' + loaded.length + ' messages from ' + transcriptPath);
  } else {
    messages = [buildUserMessage(prompt, stdinText)];
    if (transcript) {
      transcript.append({ type: 'user_prompt', text: prompt });
    }
  }

  const tools = getDefinitions(ctx);
  const system = buildSystem(ctx);
  const steps = maxSteps || DEFAULT_MAX_STEPS;
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  let consecutiveToolFailures = 0;

  output.emit('system', {
    subtype: 'init',
    cwd: ctx.cwdRealpath,
    model,
    max_steps: steps,
  });

  for (let step = 1; step <= steps; step++) {
    const requestBody = {
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools,
      ...(stream && outputFormat === 'text' ? { stream: true } : {}),
    };

    if (transcript) {
      transcript.append({ type: 'request', step, model });
    }
    output.emit('model_request', { step, model });

    if (verbose) {
      console.error('[runner] step ' + step + ': sending request to bridge');
    }

    let response;
    try {
      if (stream && outputFormat === 'text') {
        response = await modelClient.postStream(requestBody, null, bridgeUrl, { streamOutput: true });
        // With streaming, the full content was printed inline. The accumulated
        // content blocks are returned for tool-use parsing.
        response = {
          id: 'streamed',
          type: 'message',
          role: 'assistant',
          content: response.content || [],
        };
      } else {
        response = await modelClient.post(requestBody, bridgeUrl);
      }
    } catch (err) {
      const msg = 'Bridge error on step ' + step + ': ' + err.message;
      if (transcript) transcript.append({ type: 'error', step, message: msg });
      output.emit('error', { step, message: msg });
      console.error(msg);

      // Retry once on bridge errors
      if (step < steps && consecutiveToolFailures < MAX_CONSECUTIVE_FAILURES) {
        consecutiveToolFailures++;
        console.error(
          '[runner] retrying after bridge error (' + consecutiveToolFailures + '/' + MAX_CONSECUTIVE_FAILURES + ')',
        );
        continue;
      }

      process.exitCode = 1;
      return;
    }

    totalUsage = addUsage(totalUsage, response.usage);
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

    if (transcript) {
      transcript.append({ type: 'assistant', step, content: response.content });
    }

    const text = extractTextBlocks(response.content);
    if (text && verbose) {
      console.error('[runner] step ' + step + ': assistant text (' + text.length + ' chars)');
    }

    const toolUses = extractToolUses(response.content);

    if (toolUses.length === 0) {
      const finalText = text;
      const result = {
        finalText,
        steps: step,
        duration_ms: Date.now() - startedAt,
        usage: totalUsage,
        events: output.events,
        streamed: stream && outputFormat === 'text',
      };
      if (transcript) transcript.writeFinal(finalText);
      output.emit('result', {
        subtype: 'success',
        duration_ms: result.duration_ms,
        num_turns: step,
        usage: totalUsage,
      });
      output.finish(result);
      return result;
    }

    const toolResults = [];

    // Process each tool call. The assistant message above is kept exactly as
    // returned, and the user tool_result blocks are batched below.
    for (const toolUse of toolUses) {
      const toolName = toolUse.name;
      const args = toolUse.input || {};
      const toolUseId = toolUse.id;
      output.emit('tool_use', {
        step,
        tool_use_id: toolUseId,
        name: toolName,
        input: args,
      });

      if (transcript) {
        transcript.append({ type: 'tool_call', step, tool: toolName, args, toolUseId });
      }

      if (verbose) {
        console.error('[runner] step ' + step + ': tool_call ' + toolName + '(' + JSON.stringify(args) + ')');
      }

      // First attempt: check permissions (may return 'ask' signal)
      let result = execute(toolName, args, ctx, toolUseId);

      // Handle confirmation prompt for write/shell tools
      if (result.needsConfirmation) {
        output.emit('approval_required', {
          step,
          tool_use_id: toolUseId,
          name: toolName,
          proposed_action: result.proposedAction,
        });
        if (transcript) {
          transcript.append({
            type: 'tool_confirm',
            step,
            tool: toolName,
            proposedAction: result.proposedAction,
          });
        }
        const choice = await confirm.ask(result.proposedAction);
        if (choice === 'allow') {
          result = executeForce(toolName, args, ctx, toolUseId);
        } else {
          if (transcript) {
            transcript.append({ type: 'tool_denied', step, tool: toolName });
          }
          result = { ok: false, text: 'User denied this action.' };
        }
      }

      // ── Retry/escalation for tool failures ──
      if (!result.ok && !result.needsConfirmation) {
        consecutiveToolFailures++;

        if (consecutiveToolFailures >= MAX_CONSECUTIVE_FAILURES) {
          const escalate =
            '\n\n⚠️  ' +
            consecutiveToolFailures +
            ' consecutive tool failures. ' +
            'The runner is stopping to prevent an infinite retry loop. ' +
            'Last failure: ' +
            toolName +
            ' — ' +
            result.text;
          result.text = (result.text || '') + escalate;
          if (transcript) {
            transcript.append({ type: 'escalation', step, tool: toolName, failures: consecutiveToolFailures });
          }
          console.error(escalate);
        } else {
          // Warn but continue — let the model see the error and try again
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
        consecutiveToolFailures = 0; // reset on success or user denial
      }

      // Log the actual result
      if (transcript) {
        transcript.append({
          type: 'tool_result',
          step,
          tool: toolName,
          ok: result.ok,
          text: result.ok ? undefined : result.text,
          bytes: result.bytes,
          toolUseId,
        });
      }

      if (verbose) {
        console.error(
          '[runner] step ' +
            step +
            ': tool_result ' +
            toolName +
            ' ok=' +
            result.ok +
            (result.text ? ' (' + result.text.length + ' chars)' : ''),
        );
      }

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

      // Keep collecting tool results; the model expects them together in the
      // next user message after the assistant tool_use message.
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Max steps reached without final answer
  const msg = 'Reached max_steps (' + steps + ') without a final answer.';
  if (transcript) transcript.append({ type: 'final', text: msg });
  output.emit('error', {
    message: msg,
    duration_ms: Date.now() - startedAt,
    num_turns: steps,
    usage: totalUsage,
  });
  output.finish({
    finalText: msg,
    steps,
    duration_ms: Date.now() - startedAt,
    usage: totalUsage,
    events: output.events,
  });
  process.exitCode = 1;
  return {
    finalText: msg,
    steps,
    duration_ms: Date.now() - startedAt,
    usage: totalUsage,
    events: output.events,
  };
}

module.exports = { run, extractTextBlocks, extractToolUses, loadMessagesFromTranscript };
