'use strict';

/**
 * tool-pipeline.js — The tool pipeline (see CONTEXT.md).
 *
 * The deep module owning everything between "the model emitted tool_use
 * blocks" and "completed, recorded tool results exist": permission check,
 * confirmation, plan-mode fabrication, execution (via tool-registry),
 * failure-streak accounting, and the sink fan-out.
 *
 * Interface:
 *
 *   const pipeline = createToolPipeline({
 *     ctx, runId,
 *     confirm,            // confirm port: { ask(proposedAction, timeoutMs) → 'allow'|'deny' }
 *     sinks: { ledger, hooks, output, trace, transcript, humanLog, archive }, // each nullable
 *     verbosity: { verbose, quiet },
 *     failureLimit,           // consecutive failures before escalation text
 *     initialFailureStreak,   // seed on session resume
 *   });
 *
 *   pipeline.toolDefinitions()                 // tools shown to the model —
 *                                              // derived from the same ctx that
 *                                              // gates execution, so the model
 *                                              // can never see a tool the
 *                                              // pipeline would refuse to run.
 *   await pipeline.executeTurn(step, toolUses, { midTurnCheck })
 *   pipeline.failureStreak                     // getter, for persistence
 *   pipeline.recordExternalFailure()           // bridge errors share the streak
 *
 * Invariants the implementation guarantees:
 *
 * - Effect pairing: every tool use appends a ledger `tool_effect_intent`
 *   (fresh effectId) before execution and exactly one `tool_effect_result`
 *   with the same effectId after — including on throw, deny, plan-mode
 *   fabrication, and user denial. Read and write paths pair identically.
 * - Per-tool sink order: ledger intent → pre_tool hook → tool_use event →
 *   tool_requested trace → tool_call transcript → execute → tool_result
 *   transcript → human log → tool_finished trace → archive → ledger result →
 *   post_tool hook → tool_result event.
 * - Read-only tools run as one batch (sibling failures annotate survivors);
 *   write tools run serially in model-emitted order. Under accept-edits —
 *   and never in plan mode — disjoint-path write groups pre-execute in
 *   parallel while sinks still observe events in model-emitted order.
 * - Plan mode never executes a write: the pipeline fabricates
 *   `Plan mode: would <action>` results in one place.
 * - The ledger is the critical sink: its failure aborts the turn (an effect
 *   that cannot be recorded would break crash recovery). Every other sink is
 *   best-effort: failures are reported to stderr and never alter results.
 *
 * Error modes: tool failures, permission denials, user denials, and unknown
 * tools become `is_error` results — executeTurn never rejects for them. It
 * rejects only on malformed toolUses, a ledger append failure, or a confirm
 * port that throws.
 */

const path = require('path');
const { getDefinitions, execute, executeForce, executeReadOnlyBatch } = require('./tool-registry');
const { CATEGORIES } = require('./tool-catalog');
const safety = require('./safety');
const { makeEffectId } = require('./session-ledger');
const { bytes } = require('../trace-utils');
const { runIfEnabled, formatVerificationAppendix } = require('./test-watcher');
const { buildToolResultContent } = require('./tool-result-content');
const { createRepeatToolDetector, formatRepeatWarningNote } = require('./repeat-tool-detector');

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

function traceRepeatWarning(runId, warning) {
  return {
    run_id: runId,
    turn: warning.step,
    tool_use_id: warning.tool_use_id,
    tool: warning.tool,
    kind: warning.kind,
    count: warning.count,
    threshold: warning.threshold,
    window: warning.window,
    path: warning.path,
    offset: warning.offset,
    limit: warning.limit,
    max_bytes: warning.max_bytes,
    compaction_generation: warning.compactionGeneration,
    after_compaction: warning.afterCompaction,
    message: warning.message,
  };
}

function createToolPipeline(deps = {}) {
  const { ctx, runId, confirm, sinks = {}, verbosity = {}, failureLimit = 2, initialFailureStreak = 0 } = deps;
  if (!ctx) throw new Error('createToolPipeline: ctx is required');
  if (!confirm || typeof confirm.ask !== 'function') {
    throw new Error('createToolPipeline: confirm port with ask() is required');
  }
  const { ledger, hooks, output, trace, transcript, humanLog, archive } = sinks;
  const verbose = !!verbosity.verbose;
  const quiet = !!verbosity.quiet;
  const repeatDetector = deps.repeatDetector || createRepeatToolDetector(deps.repeatDetectorPolicy || {});
  let failureStreak = initialFailureStreak > 0 ? initialFailureStreak : 0;

  // Non-ledger sinks are best-effort: a broken transcript or log must not
  // alter tool results or abort the run.
  function bestEffort(name, fn) {
    try {
      fn();
    } catch (err) {
      if (!quiet) console.error('[runner] ' + name + ' sink failed: ' + err.message);
    }
  }

  // The ledger is critical — append failures propagate. Hook notification of
  // ledger events stays best-effort.
  function appendLedger(type, payload) {
    if (!ledger) return null;
    const ev = ledger.append(type, payload);
    if (hooks && ev) {
      bestEffort('hooks', () => hooks.noteLedgerEvent({ type, seq: ev.seq, ts: ev.ts, ...payload }));
    }
    return ev;
  }

  // Pre-execution fan-out, shared by the read batch and the serial write loop.
  function recordRequested(step, tu, effectId) {
    appendLedger('tool_effect_intent', { runId, step, tool: tu.name, toolUseId: tu.id, effectId });
    bestEffort('hooks', () => hooks && hooks.dispatch('pre_tool', { step, tool: tu.name, toolUseId: tu.id }));
    bestEffort(
      'output',
      () => output && output.emit('tool_use', { step, tool_use_id: tu.id, name: tu.name, input: tu.input || {} }),
    );
    bestEffort('trace', () => trace && trace.append('tool_requested', traceToolUse(runId, step, tu, trace)));
    bestEffort(
      'transcript',
      () =>
        transcript && transcript.append({ type: 'tool_call', step, tool: tu.name, args: tu.input, toolUseId: tu.id }),
    );
  }

  function attachRepeatWarning(step, tu, result) {
    const warning = repeatDetector.noteToolResult(step, tu, result, ctx);
    if (!warning) return null;

    const note = formatRepeatWarningNote(warning);
    result.text = result.text ? result.text + '\n\n' + note : note;
    result.loopWarning = warning;

    if (result.envelope) {
      result.envelope.text = result.text;
      result.envelope.summary = result.text.length > 200 ? result.text.slice(0, 200) + '...' : result.text;
      result.envelope.safetyTags = [...new Set([...(result.envelope.safetyTags || []), 'repeat_tool_warning'])];
    }

    return warning;
  }

  // Post-execution fan-out, shared by both phases.
  function recordCompleted(step, tu, result, effectId) {
    const repeatWarning = attachRepeatWarning(step, tu, result);

    bestEffort(
      'transcript',
      () =>
        transcript &&
        transcript.append({
          type: 'tool_result',
          step,
          tool: tu.name,
          ok: result.ok,
          text: result.text,
          bytes: result.bytes,
          toolUseId: tu.id,
        }),
    );
    bestEffort('humanLog', () => humanLog && humanLog.writeToolResult(step, tu.name, tu.id, result));
    bestEffort('trace', () => trace && trace.append('tool_finished', traceToolResult(runId, step, tu, result, trace)));
    bestEffort('archive', () => archive && archive.recordTool(step, tu.name, tu.id, tu.input, result));
    appendLedger('tool_effect_result', { runId, step, tool: tu.name, toolUseId: tu.id, effectId, ok: result.ok });
    if (repeatWarning) {
      appendLedger('repeat_tool_warning', { runId, ...repeatWarning });
      bestEffort('trace', () => trace && trace.append('repeat_tool_warning', traceRepeatWarning(runId, repeatWarning)));
      bestEffort('output', () => output && output.emit('repeat_tool_warning', repeatWarning));
      if (!quiet) console.error('[runner warning] ' + repeatWarning.message);
    }
    bestEffort('hooks', () => hooks && hooks.dispatch('post_tool', { step, tool: tu.name, ok: result.ok }));
    bestEffort(
      'output',
      () =>
        output &&
        output.emit('tool_result', {
          step,
          tool_use_id: tu.id,
          name: tu.name,
          content: result.text || '',
          is_error: !result.ok,
          bytes: result.bytes,
          envelope: result.envelope,
          permission: result.permission,
        }),
    );
    if (verbose) {
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
  }

  function fabricatePlanResult(result) {
    return { ok: true, text: 'Plan mode: would ' + result.proposedAction, permission: result.permission };
  }

  // Failure streak: counted on the write/shell path only (read failures never
  // escalated historically). Escalation text is appended before the result is
  // recorded so every sink sees it identically.
  function noteWriteOutcome(step, toolName, result) {
    let escalated = false;
    if (!result.ok && !result.needsConfirmation) {
      failureStreak++;
      if (failureStreak >= failureLimit) {
        const escalate =
          '\n\n⚠️  ' +
          failureStreak +
          ' consecutive tool failures. The runner is stopping to prevent an infinite retry loop. Last failure: ' +
          toolName +
          ' — ' +
          result.text;
        result.text = (result.text || '') + escalate;
        escalated = true;
        bestEffort(
          'transcript',
          () => transcript && transcript.append({ type: 'escalation', step, tool: toolName, failures: failureStreak }),
        );
        console.error(escalate);
      } else if (!quiet) {
        console.error(
          '[runner] tool failure (' +
            failureStreak +
            '/' +
            failureLimit +
            '): ' +
            toolName +
            ' — ' +
            (result.text || 'unknown error').slice(0, 200),
        );
      }
    } else {
      failureStreak = 0;
    }
    return escalated;
  }

  async function executeTurn(step, toolUses, opts = {}) {
    if (!Array.isArray(toolUses) || toolUses.some((tu) => !tu || !tu.id || !tu.name)) {
      throw new Error('executeTurn: toolUses must be an array of { id, name, input }');
    }
    const midTurnCheck = typeof opts.midTurnCheck === 'function' ? opts.midTurnCheck : null;

    const toolResults = [];
    const outcomes = [];
    let escalated = false;

    const readTools = [];
    const writeTools = [];
    for (const tu of toolUses) {
      if ((CATEGORIES[tu.name] || '') === 'read-only') readTools.push(tu);
      else writeTools.push(tu);
    }

    // ── Read phase: parallel batch ──
    if (readTools.length > 0 && verbose) {
      console.error('[runner] step ' + step + ': executing ' + readTools.length + ' read-only tools in parallel');
    }
    const readEffectIds = new Map();
    for (const tu of readTools) {
      const effectId = makeEffectId();
      readEffectIds.set(tu.id, effectId);
      recordRequested(step, tu, effectId);
    }
    const readBatch = readTools.length > 0 ? await executeReadOnlyBatch(readTools, ctx) : [];
    const readOutcomes = [];
    for (const { toolUse: tu, result: rawResult } of readBatch) {
      let result = rawResult;
      if (result.needsConfirmation && ctx.plan) {
        result = fabricatePlanResult(result);
      }
      recordCompleted(step, tu, result, readEffectIds.get(tu.id));
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: buildToolResultContent(result),
        is_error: !result.ok,
      });
      const outcome = { toolUse: tu, result, phase: 'read' };
      readOutcomes.push(outcome);
      outcomes.push(outcome);
    }

    // ── Mid-turn check: the agent loop's one chance to stop the turn (cycle,
    // wall-clock, cost) after reads are recorded but before any write effect.
    if (midTurnCheck) {
      const verdict = await midTurnCheck(readOutcomes);
      if (verdict && verdict.stop) {
        return {
          toolResults,
          outcomes,
          failureStreak,
          escalated,
          aborted: { afterPhase: 'read', reason: verdict.stop, message: verdict.message || String(verdict.stop) },
        };
      }
    }

    // ── Write phase: serial, in model-emitted order ──
    // B3: under accept-edits, pre-execute groups of consecutive writes whose
    // canonical paths are disjoint via Promise.all. The serial loop below
    // consumes cached results so sinks still observe events in the model's
    // emitted order. Never in plan mode: executeForce would bypass the
    // plan-mode fabrication and write for real.
    const parallelResults = new Map();
    if (ctx.acceptEdits === true && !ctx.plan && writeTools.length > 1) {
      const groups = _groupDisjointWrites(writeTools, ctx);
      for (const group of groups) {
        if (group.length < 2) continue;
        appendLedger('tool_use_group', {
          runId,
          step,
          toolUseIds: group.map((t) => t.id),
          tools: group.map((t) => t.name),
        });
        const groupResults = await Promise.all(group.map((tu) => executeForce(tu.name, tu.input || {}, ctx, tu.id)));
        for (let i = 0; i < group.length; i++) {
          parallelResults.set(group[i].id, groupResults[i]);
        }
      }
    }

    for (const tu of writeTools) {
      const args = tu.input || {};
      const effectId = makeEffectId();
      recordRequested(step, tu, effectId);
      if (verbose) {
        console.error('[runner] step ' + step + ': tool_call ' + tu.name + '(' + JSON.stringify(args) + ')');
      }

      let result = parallelResults.has(tu.id) ? parallelResults.get(tu.id) : await execute(tu.name, args, ctx, tu.id);

      if (result.needsConfirmation) {
        bestEffort(
          'trace',
          () =>
            trace &&
            trace.append('permission_decision', {
              run_id: runId,
              turn: step,
              tool_use_id: tu.id,
              tool: tu.name,
              decision: 'approval_required',
              proposed_action: trace.capture(result.proposedAction),
              permission: result.permission,
            }),
        );
        bestEffort(
          'output',
          () =>
            output &&
            output.emit('approval_required', {
              step,
              tool_use_id: tu.id,
              name: tu.name,
              proposed_action: result.proposedAction,
            }),
        );
        bestEffort(
          'transcript',
          () =>
            transcript &&
            transcript.append({ type: 'tool_confirm', step, tool: tu.name, proposedAction: result.proposedAction }),
        );
        if (ctx.plan) {
          result = fabricatePlanResult(result);
        } else {
          const choice = await confirm.ask(result.proposedAction, ctx.confirmTimeout);
          bestEffort(
            'trace',
            () =>
              trace &&
              trace.append('approval_resolved', {
                run_id: runId,
                turn: step,
                tool_use_id: tu.id,
                tool: tu.name,
                decision: choice,
              }),
          );
          if (choice === 'allow') {
            result = await executeForce(tu.name, args, ctx, tu.id);
          } else {
            bestEffort(
              'transcript',
              () => transcript && transcript.append({ type: 'tool_denied', step, tool: tu.name }),
            );
            result = { ok: false, text: 'User denied this action.' };
          }
        }
      }

      if (noteWriteOutcome(step, tu.name, result)) escalated = true;

      recordCompleted(step, tu, result, effectId);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: buildToolResultContent(result),
        is_error: !result.ok,
      });
      outcomes.push({ toolUse: tu, result, phase: 'write' });
    }

    const hadSuccessfulWrite = outcomes.some((o) => o.phase === 'write' && o.result && o.result.ok);
    if (hadSuccessfulWrite && !ctx.plan) {
      const watch = runIfEnabled(ctx);
      if (watch.ran) {
        const appendix = formatVerificationAppendix(watch);
        const lastWrite = [...outcomes].reverse().find((o) => o.phase === 'write');
        if (lastWrite && appendix) {
          lastWrite.result.text = (lastWrite.result.text || '') + '\n\n' + appendix;
          const idx = toolResults.findIndex((tr) => tr.tool_use_id === lastWrite.toolUse.id);
          if (idx >= 0) toolResults[idx].content = lastWrite.result.text;
        }
      }
    }

    return { toolResults, outcomes, failureStreak, escalated, aborted: null };
  }

  return {
    toolDefinitions() {
      return getDefinitions(ctx);
    },
    executeTurn,
    get failureStreak() {
      return failureStreak;
    },
    // Bridge errors share the consecutive-failure streak with tool failures —
    // the agent loop's retry gate reads and advances the same counter.
    recordExternalFailure() {
      failureStreak++;
      return failureStreak;
    },
  };
}

module.exports = {
  createToolPipeline,
  _arePathsDisjoint,
  _groupDisjointWrites,
};
