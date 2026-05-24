'use strict';

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { legacyLogsDir } = require('./paths');
const { RunArchiveCollector } = require('./collector');
const { finalizeArchiveExport } = require('./run-exporter');
const { hasRunId } = require('./indexer');

function stemToRunId(stem) {
  return 'legacy-' + stem.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseLegacyJsonl(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function eventsToCollector(runId, events, meta = {}) {
  const collector = new RunArchiveCollector({
    runId,
    sessionId: meta.sessionId || null,
    cwd: meta.cwd || null,
    model: meta.model || 'unknown',
    prompt: meta.prompt || '',
    source: 'legacy-ingest',
    startedAt: meta.startedAt || new Date().toISOString(),
  });

  let lastStep = 0;
  let finalText = '';
  let stopReason = 'legacy_imported';

  for (const ev of events) {
    if (ev.type === 'user_prompt') {
      collector.recordUser(ev.text || meta.prompt || '', '');
    } else if (ev.type === 'assistant') {
      lastStep = ev.step || lastStep;
      collector.recordAssistant(ev.step || lastStep, { content: ev.content });
    } else if (ev.type === 'tool_call') {
      lastStep = ev.step || lastStep;
      // tool result may follow; placeholder tool turn on result
    } else if (ev.type === 'tool_result') {
      lastStep = ev.step || lastStep;
      collector.recordTool(
        ev.step || lastStep,
        ev.tool || 'tool',
        ev.toolUseId,
        {},
        {
          ok: ev.ok,
          text: ev.text,
          bytes: ev.bytes,
        },
      );
    } else if (ev.type === 'final') {
      finalText = ev.text || '';
      collector.recordFinal(finalText);
    } else if (ev.type === 'error') {
      lastStep = ev.step || lastStep;
      collector.recordError(ev.step, ev.message);
      stopReason = 'legacy_error';
    }
  }

  if (!collector.turns.some((t) => t.kind === 'user') && meta.prompt) {
    collector.recordUser(meta.prompt, '');
  }

  return { collector, lastStep, finalText, stopReason };
}

function ingestLegacyFile(filePath, options = {}) {
  const stem = path.basename(filePath, '.jsonl');
  const runId = options.runId || stemToRunId(stem);
  if (!options.force && hasRunId(runId)) {
    return { skipped: true, runId, reason: 'already_indexed' };
  }

  const events = parseLegacyJsonl(filePath);
  const firstPrompt = events.find((e) => e.type === 'user_prompt');
  const mtime = fs.statSync(filePath).mtime.toISOString();
  const { collector, lastStep, finalText, stopReason } = eventsToCollector(runId, events, {
    prompt: firstPrompt?.text || stem,
    startedAt: mtime,
    cwd: options.cwd || null,
    model: options.model || 'unknown',
  });

  finalizeArchiveExport(collector, {
    stopReason,
    finalText,
    steps: lastStep,
    duration_ms: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    transcriptPath: filePath,
    replaceCatalog: !!options.force,
  });

  return { skipped: false, runId, turnCount: collector.turns.length };
}

function ingestLegacyLogs(options = {}) {
  const logDir = options.logDir || legacyLogsDir();
  if (!fs.existsSync(logDir)) return { ingested: 0, skipped: 0, errors: [] };

  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(logDir, f));

  let ingested = 0;
  let skipped = 0;
  const errors = [];

  for (const filePath of files) {
    try {
      const r = ingestLegacyFile(filePath, { force: options.force });
      if (r.skipped) skipped++;
      else ingested++;
    } catch (err) {
      errors.push({ file: filePath, message: safety.scrubSecrets(err.message) });
    }
  }

  const { rebuildIndex } = require('./indexer');
  rebuildIndex();

  return { ingested, skipped, errors, total: files.length };
}

module.exports = {
  stemToRunId,
  ingestLegacyFile,
  ingestLegacyLogs,
  parseLegacyJsonl,
};
