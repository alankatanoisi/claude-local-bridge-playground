'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { RunArchiveCollector, isArchiveEnabled } = require('../../src/runner/archive/collector');
const { finalizeArchiveExport } = require('../../src/runner/archive/run-exporter');
const { turnFilename, buildTurnEnvelope } = require('../../src/runner/archive/turn-schema');
const { hasRunId, rebuildIndex } = require('../../src/runner/archive/indexer');
const { runDir, turnsDir, legacyLogsDir } = require('../../src/runner/archive/paths');
const { ingestLegacyFile } = require('../../src/runner/archive/legacy-ingest');
const { searchCatalog, rebuildSpreadsheets } = require('../../src/runner/archive/spreadsheet');

let tmpHome;
let tmpArchive;

before(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-archive-test-'));
  tmpArchive = path.join(tmpHome, 'archive');
  process.env.BRIDGE_RUNNER_HOME = tmpHome;
  process.env.BRIDGE_RUNNER_ARCHIVE_ROOT = tmpArchive;
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.BRIDGE_RUNNER_HOME;
  delete process.env.BRIDGE_RUNNER_ARCHIVE_ROOT;
});

describe('archive export', () => {
  it('isArchiveEnabled respects env and noArchive flag', () => {
    const prev = process.env.BRIDGE_RUNNER_ARCHIVE;
    process.env.BRIDGE_RUNNER_ARCHIVE = '0';
    assert.equal(isArchiveEnabled({}), false);
    assert.equal(isArchiveEnabled({ noArchive: true }), false);
    process.env.BRIDGE_RUNNER_ARCHIVE = '1';
    assert.equal(isArchiveEnabled({}), true);
    process.env.BRIDGE_RUNNER_ARCHIVE = prev;
  });

  it('turnFilename follows seq-kind pattern', () => {
    assert.equal(turnFilename(1, 'user'), '001-user.json');
    assert.equal(turnFilename(2, 'tool', 'read_file', 'toolu_abc123xyz'), '002-tool-read_file-toolu_ab.json');
  });

  it('finalizeArchiveExport writes run dir and catalog entry', () => {
    const runId = 'test-run-' + Date.now();
    const collector = new RunArchiveCollector({
      runId,
      cwd: '/tmp/project',
      model: 'claude-test',
      prompt: 'hello archive',
    });
    collector.recordUser('hello archive', '');
    collector.recordAssistant(1, {
      content: [{ type: 'text', text: 'hi' }],
    });
    finalizeArchiveExport(collector, {
      stopReason: 'success',
      finalText: 'hi',
      steps: 1,
      duration_ms: 10,
      usage: { input_tokens: 1, output_tokens: 2 },
    });

    const rdir = runDir(runId);
    assert.ok(fs.existsSync(path.join(rdir, 'meta.json')));
    assert.ok(fs.existsSync(path.join(rdir, 'outcome.json')));
    assert.ok(fs.existsSync(path.join(turnsDir(runId), '001-user.json')));
    assert.ok(hasRunId(runId));
    const hits = searchCatalog('hello archive', 5);
    assert.ok(hits.some((h) => h.runId === runId));
  });

  it('ingestLegacyFile imports jsonl transcript', () => {
    const logDir = legacyLogsDir();
    fs.mkdirSync(logDir, { recursive: true });
    const jsonl = path.join(logDir, '2020-01-01T00-00-00.jsonl');
    fs.writeFileSync(
      jsonl,
      [
        JSON.stringify({ type: 'user_prompt', text: 'legacy prompt here' }),
        JSON.stringify({ type: 'assistant', step: 1, content: [{ type: 'text', text: 'ok' }] }),
        JSON.stringify({ type: 'final', text: 'done' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const r = ingestLegacyFile(jsonl);
    assert.equal(r.skipped, false);
    assert.ok(r.runId.startsWith('legacy-'));
    assert.ok(fs.existsSync(runDir(r.runId)));
    rebuildIndex();
    const sheet = rebuildSpreadsheets();
    assert.ok(sheet.rowCount >= 1);
  });

  it('buildTurnEnvelope has schema version', () => {
    const env = buildTurnEnvelope({ kind: 'user', seq: 1, runId: 'r1', input: {}, output: {} });
    assert.equal(env.schemaVersion, 1);
    assert.equal(env.runId, 'r1');
  });
});
