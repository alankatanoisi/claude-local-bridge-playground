'use strict';

// The projector is the only owner of lossy request shaping. Callers keep the
// original messages as canonical history and must never assign this projection
// back to their session state.

const crypto = require('crypto');
const { groupSemanticExchanges } = require('./message-contract');
const { stringifyToolResultContent } = require('./tool-result-content');
const { estimateRequest, fingerprint } = require('./context-estimator');
const { pressureTier } = require('./context-runtime-policy');
const { renderSessionAnchor } = require('./session-anchor');
const { CATEGORIES, WRITE_TOOLS } = require('./tool-catalog');

const OLD_RESULT_CLIP_CHARS = 12_000;
const CHECKPOINT_DIGEST_CHARS = 24_000;
const CANONICAL_HIGH_WATER_BYTES = 32 * 1024 * 1024;

function sourceHash(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''))
    .digest('hex')
    .slice(0, 16);
}

function headTail(text, maxChars, label) {
  if (text.length <= maxChars) return text;
  const marker =
    '\n… [' +
    label +
    '; omitted=' +
    (text.length - maxChars) +
    '; sha256=' +
    sourceHash(text) +
    '; chars=' +
    text.length +
    '] …\n';
  const room = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(room / 2);
  return text.slice(0, head) + marker + text.slice(text.length - (room - head));
}

function cloneMessages(messages) {
  // Content blocks are cloned only when changed. Untouched signed blocks retain
  // both exact bytes and object identity.
  return messages.slice();
}

function protectedCutoff(messages, count) {
  const groups = groupSemanticExchanges(messages);
  if (groups.length <= count) return { cutoff: 0, groups };
  return { cutoff: groups[groups.length - count].start, groups };
}

function toolUseById(messages) {
  const map = new Map();
  for (let index = 0; index < messages.length; index++) {
    for (const block of Array.isArray(messages[index]?.content) ? messages[index].content : []) {
      if (block?.type === 'tool_use' && block.id) map.set(block.id, { ...block, messageIndex: index });
    }
  }
  return map;
}

function reduceOldEvidence(messages, cutoff, targetTokens, requestBase, factor) {
  let current = cloneMessages(messages);
  const uses = toolUseById(messages);
  const writes = [];
  for (const use of uses.values()) {
    if (WRITE_TOOLS.has(use.name) && use.input?.path) writes.push({ path: use.input.path, index: use.messageIndex });
  }
  const stats = { staleDropped: 0, clipped: 0, stubbed: 0, charsRemoved: 0 };

  function rewriteResult(predicate, transform) {
    current = current.map((message, index) => {
      if (index >= cutoff || message.role !== 'user' || !Array.isArray(message.content)) return message;
      let changed = false;
      const content = message.content.map((block) => {
        if (block?.type !== 'tool_result' || !predicate(block)) return block;
        const before = stringifyToolResultContent(block.content);
        const after = transform(block, before);
        if (after === before) return block;
        changed = true;
        stats.charsRemoved += Math.max(0, before.length - after.length);
        return { ...block, content: after };
      });
      return changed ? { ...message, content } : message;
    });
  }

  // First remove evidence that is provably stale because a later write changed
  // the same path.
  rewriteResult(
    (block) => {
      const use = uses.get(block.tool_use_id);
      return (
        use &&
        CATEGORIES[use.name] === 'read-only' &&
        use.input?.path &&
        writes.some((write) => write.path === use.input.path && write.index > use.messageIndex)
      );
    },
    (_block, before) => {
      stats.staleDropped++;
      return '[context:stale-read] Superseded result; re-read current bytes. original_chars=' + before.length;
    },
  );

  function occupancy() {
    return estimateRequest({ ...requestBase, messages: current }, factor).calibratedTokens;
  }

  if (occupancy() > targetTokens) {
    rewriteResult(
      (block) => stringifyToolResultContent(block.content).length > OLD_RESULT_CLIP_CHARS,
      (_block, before) => {
        stats.clipped++;
        return headTail(before, OLD_RESULT_CLIP_CHARS, 'context:old-result-head-tail');
      },
    );
  }

  if (occupancy() > targetTokens) {
    rewriteResult(
      (block) => stringifyToolResultContent(block.content).length > 300,
      (block, before) => {
        stats.stubbed++;
        const use = uses.get(block.tool_use_id);
        return (
          '[context:old-result-refetch] tool=' +
          (use?.name || 'unknown') +
          (use?.input?.path ? '; path=' + use.input.path : '') +
          '; original_chars=' +
          before.length +
          '; sha256=' +
          sourceHash(before)
        );
      },
    );
  }
  return { messages: current, stats };
}

function digestRawMessages(messages, rawCutoff) {
  const selected = messages.slice(0, rawCutoff);
  const lines = ['[context:raw-checkpoint v1]', 'Raw messages: 0..' + Math.max(0, rawCutoff - 1)];
  for (const message of selected) {
    if (typeof message.content === 'string') {
      lines.push(message.role + ': ' + headTail(message.content, 600, 'checkpoint-evidence'));
      continue;
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === 'text' && block.text) {
        lines.push(message.role + ': ' + headTail(block.text, 600, 'checkpoint-evidence'));
      } else if (block.type === 'tool_use') {
        lines.push(
          'tool_use ' +
            block.name +
            (block.input?.path ? ' path=' + block.input.path : '') +
            ' input_sha256=' +
            sourceHash(JSON.stringify(block.input || {})),
        );
      } else if (block.type === 'tool_result') {
        const text = stringifyToolResultContent(block.content);
        lines.push(
          'tool_result outcome=' +
            (block.is_error ? 'error' : 'success') +
            ' chars=' +
            text.length +
            ' sha256=' +
            sourceHash(text) +
            ' evidence=' +
            headTail(text, 500, 'checkpoint-evidence'),
        );
      }
      // Signed thinking and redacted-thinking are intentionally not copied into
      // a digest. If retained in the tail they remain byte-identical.
    }
  }
  const sourceFingerprint = fingerprint(selected);
  const text = headTail(lines.join('\n'), CHECKPOINT_DIGEST_CHARS, 'checkpoint-budget');
  return { text: text + '\nSource fingerprint: ' + sourceFingerprint, sourceFingerprint };
}

function checkpointProjection(messages, contextState, policy, requestBase, factor) {
  const groups = groupSemanticExchanges(messages);
  const minimumTailGroup = Math.max(0, groups.length - policy.protectedExchanges);
  let selectedCutoff = contextState?.checkpoint?.rawCutoff || 0;
  let stable = selectedCutoff > 0;

  function build(cutoff) {
    if (cutoff <= 0) return messages;
    const digest = digestRawMessages(messages, cutoff);
    return [{ role: 'user', content: digest.text }, ...messages.slice(cutoff)];
  }

  let projected = build(selectedCutoff);
  let estimate = estimateRequest({ ...requestBase, messages: projected }, factor);
  if (estimate.calibratedTokens >= policy.checkpoint) {
    stable = false;
    for (let groupIndex = 1; groupIndex <= minimumTailGroup; groupIndex++) {
      const cutoff = groups[groupIndex - 1].end;
      const candidate = build(cutoff);
      const candidateEstimate = estimateRequest({ ...requestBase, messages: candidate }, factor);
      selectedCutoff = cutoff;
      projected = candidate;
      estimate = candidateEstimate;
      if (candidateEstimate.calibratedTokens < policy.compact) break;
    }
  }
  if (selectedCutoff <= 0) return { messages, checkpoint: null, stable: true };
  const digest = digestRawMessages(messages, selectedCutoff);
  const previous = contextState?.checkpoint;
  const same = previous?.rawCutoff === selectedCutoff && previous?.sourceFingerprint === digest.sourceFingerprint;
  const checkpoint = same
    ? previous
    : {
        epoch: Math.max(0, previous?.epoch || 0) + 1,
        rawCutoff: selectedCutoff,
        digest: digest.text,
        sourceFingerprint: digest.sourceFingerprint,
      };
  return {
    messages: [{ role: 'user', content: checkpoint.digest }, ...messages.slice(selectedCutoff)],
    checkpoint,
    stable: stable && same,
  };
}

function appendAnchor(messages, anchor) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role !== 'user') continue;
    const message = messages[index];
    const block = { type: 'text', text: anchor };
    const content =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }, block]
        : [...(Array.isArray(message.content) ? message.content : []), block];
    const out = messages.slice();
    out[index] = { ...message, content };
    return out;
  }
  return [...messages, { role: 'user', content: anchor }];
}

function emergencyReduceRecent(messages, policy) {
  let largest = null;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    for (
      let blockIndex = 0;
      blockIndex < (Array.isArray(message?.content) ? message.content.length : 0);
      blockIndex++
    ) {
      const block = message.content[blockIndex];
      if (block?.type !== 'tool_result') continue;
      const text = stringifyToolResultContent(block.content);
      if (!largest || text.length > largest.text.length) largest = { messageIndex, blockIndex, block, text };
    }
  }
  if (!largest || largest.text.length <= policy.emergencyResultChars) return { messages, count: 0, charsRemoved: 0 };
  const out = messages.slice();
  const message = messages[largest.messageIndex];
  const content = message.content.slice();
  const reduced = headTail(largest.text, policy.emergencyResultChars, 'context:emergency-recent-result');
  content[largest.blockIndex] = { ...largest.block, content: reduced };
  out[largest.messageIndex] = { ...message, content };
  return { messages: out, count: 1, charsRemoved: largest.text.length - reduced.length };
}

function buildContextProjection(input) {
  const { messages, system, tools, policy, calibration, contextState, runtime } = input;
  const requestBase = { system, tools };
  const before = estimateRequest({ ...requestBase, messages }, calibration.factor);
  let after = before;
  const initialTier = pressureTier(before.calibratedTokens, policy);
  const canonicalBytes = Buffer.byteLength(JSON.stringify(messages));
  const { cutoff, groups } = protectedCutoff(messages, policy.protectedExchanges);
  let projected = messages;
  let checkpoint = contextState?.checkpoint || null;
  let checkpointStable = true;
  let stats = { staleDropped: 0, clipped: 0, stubbed: 0, charsRemoved: 0 };
  let emergency = { count: 0, charsRemoved: 0 };
  const stages = [];

  if (initialTier === 'ceiling' && groups.length <= 1) {
    return {
      stopReason: 'initial_prompt_too_large',
      message:
        'The initial prompt is too large for this model after reserving response output. Reference files or split the pasted material.',
      messages,
      contextState,
      decision: decisionMetadata(),
    };
  }

  if (['compact', 'checkpoint', 'ceiling'].includes(initialTier)) {
    const reduced = reduceOldEvidence(projected, cutoff, policy.compact, requestBase, calibration.factor);
    projected = reduced.messages;
    stats = reduced.stats;
    if (stats.staleDropped) stages.push('drop_stale_old_results');
    if (stats.clipped) stages.push('clip_old_results_head_tail');
    if (stats.stubbed) stages.push('stub_old_results');
  }

  let currentEstimate = estimateRequest({ ...requestBase, messages: projected }, calibration.factor);
  if (currentEstimate.calibratedTokens >= policy.checkpoint && groups.length > policy.protectedExchanges) {
    const checkpointed = checkpointProjection(messages, contextState, policy, requestBase, calibration.factor);
    projected = checkpointed.messages;
    checkpoint = checkpointed.checkpoint;
    checkpointStable = checkpointed.stable;
    if (checkpoint) stages.push(checkpointStable ? 'reuse_checkpoint' : 'advance_checkpoint');
  }

  currentEstimate = estimateRequest({ ...requestBase, messages: projected }, calibration.factor);
  if (currentEstimate.calibratedTokens >= policy.inputCeiling) {
    emergency = emergencyReduceRecent(projected, policy);
    projected = emergency.messages;
    if (emergency.count) stages.push('emergency_recent_result_reduction');
  }

  const lossy = stages.some((stage) => !['reuse_checkpoint'].includes(stage));
  if (stages.length > 0 || checkpoint) {
    projected = appendAnchor(projected, renderSessionAnchor(contextState, runtime));
    stages.push('session_anchor');
  }
  after = estimateRequest({ ...requestBase, messages: projected }, calibration.factor);
  const nextState = {
    ...(contextState || {}),
    checkpoint,
    lastDecision: { pressureTier: initialTier, reason: initialTier === 'normal' ? 'below_observe' : 'occupancy' },
  };

  if (after.calibratedTokens >= policy.inputCeiling) {
    return {
      stopReason: 'context_ceiling_unrecoverable',
      message:
        'The request cannot fit safely inside the selected model context window without changing protected recent evidence.',
      messages: projected,
      contextState: nextState,
      decision: decisionMetadata(),
    };
  }
  return { messages: projected, contextState: nextState, decision: decisionMetadata() };

  function decisionMetadata() {
    return {
      policySource: policy.source,
      catalogVersion: policy.catalogVersion,
      limitsEstimated: policy.limitsEstimated,
      contextWindow: policy.contextWindow,
      requestedOutputReserve: policy.requestedOutputTokens,
      inputCeiling: policy.inputCeiling,
      thresholds: { observe: policy.observe, compact: policy.compact, checkpoint: policy.checkpoint },
      pressureTier: initialTier,
      beforeUncalibratedTokens: before.uncalibratedTokens,
      beforeCalibratedTokens: before.calibratedTokens,
      afterUncalibratedTokens: after?.uncalibratedTokens || before.uncalibratedTokens,
      afterCalibratedTokens: after?.calibratedTokens || before.calibratedTokens,
      calibrationFactor: calibration.factor,
      calibrationSamples: calibration.samples,
      previousObservedTokens: calibration.lastObservedTokens,
      stages,
      protectedExchanges: Math.min(policy.protectedExchanges, groups.length),
      oldResultsDropped: stats.staleDropped,
      oldResultsClipped: stats.clipped,
      oldResultsStubbed: stats.stubbed,
      charactersRemoved: stats.charsRemoved + emergency.charsRemoved,
      emergencyReductionCount: emergency.count,
      anchorPresent: stages.includes('session_anchor'),
      checkpointEpoch: checkpoint?.epoch || 0,
      checkpointRawCutoff: checkpoint?.rawCutoff || 0,
      checkpointStable,
      checkpointDigestChars: checkpoint?.digest?.length || 0,
      canonicalMessageCount: messages.length,
      canonicalBytes,
      canonicalHighWater: canonicalBytes >= CANONICAL_HIGH_WATER_BYTES,
      systemPrefixHash: fingerprint(system),
      toolsPrefixHash: fingerprint(tools),
      checkpointPrefixHash: checkpoint ? sourceHash(checkpoint.digest) : null,
      lossy,
    };
  }
}

module.exports = {
  OLD_RESULT_CLIP_CHARS,
  CHECKPOINT_DIGEST_CHARS,
  CANONICAL_HIGH_WATER_BYTES,
  headTail,
  protectedCutoff,
  digestRawMessages,
  appendAnchor,
  buildContextProjection,
};
