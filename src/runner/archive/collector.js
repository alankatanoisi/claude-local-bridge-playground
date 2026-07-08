'use strict';

/**
 * In-memory collector for live runs — flushed by finalizeArchiveExport.
 */

class RunArchiveCollector {
  constructor(meta) {
    this.meta = {
      runId: meta.runId,
      sessionId: meta.sessionId ?? null,
      cwd: meta.cwd,
      model: meta.model,
      prompt: meta.prompt,
      stdinText: meta.stdinText,
      flags: meta.flags || {},
      agentProfile: meta.agentProfile ?? null,
      transcriptPath: meta.transcriptPath ?? null,
      tracePath: meta.tracePath ?? null,
      sessionPath: meta.sessionPath ?? null,
      ledgerPath: meta.ledgerPath ?? null,
      startedAt: meta.startedAt || new Date().toISOString(),
      source: meta.source || 'live',
      coordinator: meta.coordinator || null,
    };
    this.turns = [];
    this._seq = 0;
    this.outcome = null;
  }

  nextSeq() {
    this._seq += 1;
    return this._seq;
  }

  recordUser(prompt, stdinText) {
    const seq = this.nextSeq();
    this.turns.push({
      seq,
      kind: 'user',
      step: 0,
      input: { prompt: prompt || '', stdinText: stdinText || '' },
      output: {},
    });
  }

  recordAssistant(step, response) {
    const seq = this.nextSeq();
    const text = Array.isArray(response?.content)
      ? response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
      : typeof response?.content === 'string'
        ? response.content
        : '';
    const toolUses = Array.isArray(response?.content)
      ? response.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }))
      : [];
    this.turns.push({
      seq,
      kind: 'assistant',
      step,
      input: { model: this.meta.model },
      output: { text, toolUses },
    });
  }

  recordTool(step, toolName, toolUseId, args, result) {
    const seq = this.nextSeq();
    const text = result?.text || '';
    this.turns.push({
      seq,
      kind: 'tool',
      step,
      toolName,
      toolUseId,
      input: { args: args || {} },
      output: {
        ok: !!result?.ok,
        text,
        // `bytes` is the tool's native size signal. For read_file that is the
        // source file size, while `resultBytes` is what actually went back to
        // the model. Keeping both prevents sliced reads from looking like full
        // file reads during archive forensics.
        bytes: result?.bytes,
        resultBytes: Buffer.byteLength(text, 'utf8'),
        partial: !!result?.partial,
        truncated: !!result?.truncated,
        offset: result?.offset,
        summarized: !!result?.summarized,
        droppedBytes: result?.droppedBytes,
        needsConfirmation: !!result?.needsConfirmation,
        permission: result?.permission || null,
      },
    });
  }

  recordFinal(text) {
    const seq = this.nextSeq();
    this.turns.push({
      seq,
      kind: 'final',
      step: null,
      input: {},
      output: { text: text || '' },
    });
  }

  recordError(step, message) {
    const seq = this.nextSeq();
    this.turns.push({
      seq,
      kind: 'error',
      step,
      input: {},
      output: { message: message || '' },
    });
  }

  setOutcome(patch) {
    this.outcome = {
      stopReason: patch.stopReason,
      finalText: patch.finalText,
      steps: patch.steps,
      duration_ms: patch.duration_ms,
      usage: patch.usage || {},
      estimatedCostUsd: patch.estimatedCostUsd ?? null,
    };
  }
}

function isArchiveEnabled(options = {}) {
  if (options.noArchive) return false;
  if (process.env.BRIDGE_RUNNER_ARCHIVE === '0') return false;
  return true;
}

module.exports = {
  RunArchiveCollector,
  isArchiveEnabled,
};
