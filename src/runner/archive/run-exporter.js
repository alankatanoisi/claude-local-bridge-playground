'use strict';

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { buildTurnEnvelope, turnFilename } = require('./turn-schema');
const { runDir, turnsDir } = require('./paths');
const { upsertCatalogEntry } = require('./indexer');
const { updateSessionRollup } = require('./session-rollup');

const ARCHIVE_ROOT_ID_OPTIONS = { preserveRootStableIdentifierKeys: ['sessionId'] };

function promptPreview(text, max = 200) {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const preview = s.length <= max ? s : s.slice(0, max) + '…';
  return safety.scrubSecrets(preview);
}

function writeTurnFiles(collector) {
  const { runId, sessionId, source } = collector.meta;
  const tdir = turnsDir(runId);
  fs.mkdirSync(tdir, { recursive: true });
  const written = [];
  for (const turn of collector.turns) {
    const envelope = buildTurnEnvelope({
      kind: turn.kind,
      seq: turn.seq,
      runId,
      sessionId,
      source,
      step: turn.step,
      input: turn.input,
      output: turn.output,
    });
    // Turn files can contain model text, tool output, and tool arguments. We
    // keep the JSON shape intact for archive viewers, then cover sensitive
    // string values before writing the file.
    const scrubbed = safety.scrubObject(envelope, safety.scrubSecrets, ARCHIVE_ROOT_ID_OPTIONS);
    const fname = turnFilename(turn.seq, turn.kind, turn.toolName, turn.toolUseId);
    const fpath = path.join(tdir, fname);
    fs.writeFileSync(fpath, JSON.stringify(scrubbed, null, 2) + '\n', 'utf8');
    written.push(fname);
  }
  return written;
}

function finalizeArchiveExport(collector, resultPatch = {}) {
  if (!collector || !collector.meta?.runId) return null;
  if (resultPatch.stopReason !== undefined) collector.setOutcome(resultPatch);

  const runId = collector.meta.runId;
  const endedAt = new Date().toISOString();
  const rdir = runDir(runId);
  fs.mkdirSync(rdir, { recursive: true });

  const turnFiles = writeTurnFiles(collector);
  const outcome = safety.scrubObject(
    collector.outcome || {
      stopReason: resultPatch.stopReason || 'unknown',
      finalText: resultPatch.finalText || '',
      steps: resultPatch.steps ?? 0,
      duration_ms: resultPatch.duration_ms ?? 0,
      usage: resultPatch.usage || {},
      estimatedCostUsd: resultPatch.estimatedCostUsd ?? null,
    },
  );

  const meta = safety.scrubObject(
    {
      schemaVersion: 1,
      runId,
      sessionId: collector.meta.sessionId,
      cwd: collector.meta.cwd,
      model: collector.meta.model,
      promptPreview: promptPreview(collector.meta.prompt),
      flags: collector.meta.flags,
      source: collector.meta.source,
      coordinator: collector.meta.coordinator,
      startedAt: collector.meta.startedAt,
      endedAt,
      turnCount: collector.turns.length,
      turnFiles,
    },
    safety.scrubSecrets,
    ARCHIVE_ROOT_ID_OPTIONS,
  );

  const sources = safety.scrubObject({
    transcriptPath: resultPatch.transcriptPath || collector.meta.transcriptPath,
    tracePath: resultPatch.tracePath || collector.meta.tracePath,
    sessionPath: resultPatch.sessionPath || collector.meta.sessionPath,
    ledgerPath: resultPatch.ledgerPath || collector.meta.ledgerPath,
  });

  fs.writeFileSync(path.join(rdir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(rdir, 'outcome.json'), JSON.stringify(outcome, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(rdir, 'sources.json'), JSON.stringify(sources, null, 2) + '\n', 'utf8');

  const catalogEntry = safety.scrubObject(
    {
      runId,
      sessionId: collector.meta.sessionId,
      cwd: collector.meta.cwd,
      model: collector.meta.model,
      source: collector.meta.source,
      startedAt: collector.meta.startedAt,
      endedAt,
      stopReason: outcome.stopReason,
      promptPreview: meta.promptPreview,
      steps: outcome.steps,
      duration_ms: outcome.duration_ms,
      estimatedCostUsd: outcome.estimatedCostUsd,
      turnCount: meta.turnCount,
    },
    safety.scrubSecrets,
    ARCHIVE_ROOT_ID_OPTIONS,
  );

  upsertCatalogEntry(catalogEntry, !!resultPatch.replaceCatalog);
  if (collector.meta.sessionId) {
    const { updateSessionsIndex } = require('./indexer');
    updateSessionsIndex(collector.meta.sessionId, runId, { cwd: collector.meta.cwd });
    updateSessionRollup(collector.meta.sessionId, catalogEntry);
  }

  return { runId, runDir: rdir, catalogEntry };
}

function archiveCoordinatorSummary(summary) {
  const { RunArchiveCollector } = require('./collector');
  const runId = 'coord-' + (summary.sessionId || Date.now());
  const collector = new RunArchiveCollector({
    runId,
    sessionId: summary.sessionId || null,
    cwd: summary.cwd,
    model: summary.model || 'coordinator',
    prompt: summary.objective || '',
    source: 'coordinator',
    coordinator: {
      phases: summary.phases,
      duration_ms: summary.duration_ms,
      kernelStopReason: summary.kernelResult?.stopReason || null,
    },
    startedAt: new Date(Date.now() - (summary.duration_ms || 0)).toISOString(),
  });
  collector.recordUser(summary.objective, '');
  if (summary.synthesis) {
    collector.recordAssistant(0, {
      content: [{ type: 'text', text: String(summary.synthesis).slice(0, 8000) }],
    });
  }
  if (summary.kernelResult?.finalText) collector.recordFinal(summary.kernelResult.finalText);
  finalizeArchiveExport(collector, {
    stopReason: summary.kernelResult?.stopReason || summary.error ? 'coordinator_error' : 'coordinator_done',
    finalText: summary.kernelResult?.finalText || summary.error || '',
    steps: summary.kernelResult?.steps ?? 0,
    duration_ms: summary.duration_ms,
    usage: summary.kernelResult?.usage || {},
    sessionPath: summary.sessionPath,
  });
  return runId;
}

module.exports = {
  finalizeArchiveExport,
  archiveCoordinatorSummary,
  promptPreview,
};
