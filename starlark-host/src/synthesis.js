'use strict';

/**
 * synthesis.js — the synthesis stage as an independently fallible, independently
 * RETRYABLE unit (R10).
 *
 * Field record: synthesis is the pipeline's most fragile stage — one refusal
 * and four truncations across the live campaigns (three on 2026-08-06, one on
 * 2026-08-10), every one of them AFTER the worker artifacts were already
 * durable. Two consequences drive this module's design:
 *
 * 1. Synthesis failures must be cheap: worker results are never re-run to fix
 *    a synthesis. resume-synthesis.js retries this stage alone.
 * 2. One monolithic ceiling-bound call is the failure shape. The map-reduce
 *    strategy synthesizes bounded CHUNKS of results and then combines the
 *    chunk summaries, so no single call carries the whole output burden.
 *
 * Every response is classified semantically (HTTP 200 is not success):
 * refusal, truncation, and empty responses each produce a distinct failure
 * code, with the failing stage (single/map/reduce) recorded.
 */

const SYNTHESIS_SYSTEM = `You are the final synthesis model for an authorized, defensive code-quality experiment on the user's own local runner. Use only the supplied successful worker artifacts and failure records. Distinguish evidence from inference, report incomplete coverage, and explain how the control plane handled deliberate failures. Do not provide exploit instructions. Do not claim that a failed job succeeded.`;

const DEFAULT_OPTIONS = Object.freeze({
  strategy: 'auto', // 'auto' | 'single' | 'map_reduce'
  autoThreshold: 4, // auto picks map_reduce when results outnumber this
  chunkSize: 3,
  mapMaxTokens: 900,
  reduceMaxTokens: 2500,
  singleMaxTokens: 2500,
});

function compactResult(result) {
  return result.ok
    ? { job_id: result.job.id, attempt: result.attempt, ok: true, output: result.output }
    : { job_id: result.job.id, attempt: result.attempt, ok: false, error: result.error };
}

function buildSynthesisPrompt(objective, results) {
  const compact = results.map(compactResult);
  return `OBJECTIVE:\n${objective}\n\nWORKER RESULTS AND FAILURES:\n${JSON.stringify(compact, null, 2)}`;
}

function validateSynthesisResponse(response) {
  if (response.rawStopReason === 'refusal') {
    return { code: 'model_refusal', message: 'synthesis model returned stop_reason refusal' };
  }
  if (response.rawStopReason === 'max_tokens') {
    return { code: 'truncated_synthesis', message: 'synthesis model reached its token ceiling' };
  }
  if (!response.text || !response.text.trim()) {
    return { code: 'empty_synthesis', message: 'synthesis model returned no text' };
  }
  return null;
}

function resolveSynthesisOptions(overrides = {}, resultCount = 0) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const strategy =
    options.strategy === 'auto'
      ? resultCount > options.autoThreshold
        ? 'map_reduce'
        : 'single'
      : options.strategy;
  return { ...options, strategy };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Run one synthesis attempt over durable worker results.
 * Returns { ok, text, failure, strategy, calls }.
 * Never throws for semantic failures — those come back as `failure` with a
 * `stage` ('single' | 'map' | 'reduce') so the caller can record and resume.
 */
async function runSynthesis({ bridge, model, objective, results, options }) {
  const resolved = resolveSynthesisOptions(options, results.length);

  if (resolved.strategy === 'single') {
    const response = await bridge.call({
      model,
      system: SYNTHESIS_SYSTEM,
      prompt: buildSynthesisPrompt(objective, results),
      maxTokens: resolved.singleMaxTokens,
      label: `synthesize:${model}`,
    });
    const failure = validateSynthesisResponse(response);
    return failure
      ? { ok: false, text: null, failure: { ...failure, stage: 'single' }, strategy: 'single', calls: 1 }
      : { ok: true, text: response.text, failure: null, strategy: 'single', calls: 1 };
  }

  // map: each bounded chunk of results gets its own small synthesis call.
  const chunks = chunk(results, resolved.chunkSize);
  const chunkSummaries = [];
  let calls = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const prompt =
      buildSynthesisPrompt(objective, chunks[index]) +
      `\n\nThis is part ${index + 1} of ${chunks.length} of a larger synthesis. ` +
      'Summarize ONLY the results above in at most 200 words of prose. ' +
      'State job ids, what succeeded or failed, and the strongest evidence-backed findings.';
    const response = await bridge.call({
      model,
      system: SYNTHESIS_SYSTEM,
      prompt,
      maxTokens: resolved.mapMaxTokens,
      label: `synthesize:map:${index + 1}of${chunks.length}:${model}`,
    });
    calls += 1;
    const failure = validateSynthesisResponse(response);
    if (failure) {
      return {
        ok: false,
        text: null,
        failure: { ...failure, stage: 'map', chunk: index + 1, chunks: chunks.length },
        strategy: 'map_reduce',
        calls,
      };
    }
    chunkSummaries.push(response.text);
  }

  // reduce: combine the bounded chunk summaries plus aggregate counts.
  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  const reducePrompt =
    `OBJECTIVE:\n${objective}\n\n` +
    `AGGREGATE: ${results.length} jobs, ${succeeded} succeeded, ${failed} failed.\n\n` +
    `PART SUMMARIES (each covers a disjoint set of jobs):\n` +
    chunkSummaries.map((summary, index) => `--- PART ${index + 1} ---\n${summary}`).join('\n\n') +
    '\n\nCombine the part summaries into one final synthesis. Do not invent jobs or claims ' +
    'that no part mentions, and do not claim a failed job succeeded.';
  const response = await bridge.call({
    model,
    system: SYNTHESIS_SYSTEM,
    prompt: reducePrompt,
    maxTokens: resolved.reduceMaxTokens,
    label: `synthesize:reduce:${model}`,
  });
  calls += 1;
  const failure = validateSynthesisResponse(response);
  return failure
    ? { ok: false, text: null, failure: { ...failure, stage: 'reduce' }, strategy: 'map_reduce', calls }
    : { ok: true, text: response.text, failure: null, strategy: 'map_reduce', calls };
}

module.exports = {
  DEFAULT_OPTIONS,
  SYNTHESIS_SYSTEM,
  buildSynthesisPrompt,
  resolveSynthesisOptions,
  runSynthesis,
  validateSynthesisResponse,
};
