'use strict';

/**
 * FD-10 / A7 — automated artifact-mode assertions.
 *
 * P0-12 established the rule: every artifact the *runner* owns gets explicit
 * 0700 directories and 0600 files, never the process umask. Until now the only
 * evidence for that rule holding was a human reading two `ls -l` lines during
 * permission safari 2 round P. Field measurement on 2026-07-26 then found
 * ~/.bridge-runner/archive at 0644 — the archive writers had never adopted
 * private-fs.js. This file is the standing check that replaces the eyeball.
 *
 * The P0-12 carve-out is deliberate and load-bearing: nothing here asserts
 * anything about a *user project* file. Files written by write_file / edit_file /
 * apply_patch keep normal umask behavior so the user's own project stays as
 * they expect it. Forcing modes on those would be a bug, not a hardening.
 *
 * Mode assertions are POSIX-only; Windows has no equivalent bits.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DIR_MODE, FILE_MODE, modeBits } = require('../../src/runner/private-fs');
const { RunArchiveCollector } = require('../../src/runner/archive/collector');
const { finalizeArchiveExport } = require('../../src/runner/archive/run-exporter');
const { rebuildIndex } = require('../../src/runner/archive/indexer');
const { rebuildSpreadsheets } = require('../../src/runner/archive/spreadsheet');
const { archiveRoot } = require('../../src/runner/archive/paths');
const { Transcript } = require('../../src/runner/transcript');
const { SessionStore } = require('../../src/runner/session-store');
const { SessionLedger } = require('../../src/runner/session-ledger');
const { JsonlTrace } = require('../../src/trace-utils');
const { writeRunManifest } = require('../../src/runner/recovery/run-manifest');

const skipModes = process.platform === 'win32';

let tmpHome;
let tmpArchive;
let prevHome;
let prevArchiveRoot;

before(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-10-modes-'));
  tmpArchive = path.join(tmpHome, 'archive');
  prevHome = process.env.BRIDGE_RUNNER_HOME;
  prevArchiveRoot = process.env.BRIDGE_RUNNER_ARCHIVE_ROOT;
  process.env.BRIDGE_RUNNER_HOME = tmpHome;
  process.env.BRIDGE_RUNNER_ARCHIVE_ROOT = tmpArchive;
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.BRIDGE_RUNNER_HOME;
  else process.env.BRIDGE_RUNNER_HOME = prevHome;
  if (prevArchiveRoot === undefined) delete process.env.BRIDGE_RUNNER_ARCHIVE_ROOT;
  else process.env.BRIDGE_RUNNER_ARCHIVE_ROOT = prevArchiveRoot;
});

/**
 * Walk a tree and report every path whose mode is wrong. Returning the offenders
 * rather than asserting inside the walk means a failure message names the file,
 * which is the whole point when this regresses months from now.
 */
function findModeViolations(root) {
  const bad = [];
  const walk = (current) => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) return; // mode of a symlink is not meaningful
    if (stat.isDirectory()) {
      const mode = modeBits(current);
      if (mode !== DIR_MODE) bad.push({ path: current, kind: 'dir', mode: mode.toString(8) });
      for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
      return;
    }
    const mode = modeBits(current);
    if (mode !== FILE_MODE) bad.push({ path: current, kind: 'file', mode: mode.toString(8) });
  };
  walk(root);
  return bad;
}

function describeViolations(bad) {
  return bad.map((b) => b.kind + ' ' + b.path + ' is 0' + b.mode).join('\n');
}

describe('FD-10 runner artifact modes', () => {
  it('archive export writes every run/turn/index file privately', { skip: skipModes }, () => {
    const runId = 'fd10-run-' + process.pid;
    const collector = new RunArchiveCollector({
      runId,
      sessionId: 'fd10-session',
      cwd: '/tmp/project',
      model: 'claude-test',
      prompt: 'artifact mode check',
    });
    collector.recordUser('artifact mode check', '');
    collector.recordTool(1, 'read_file', 'toolu_fd10_abcdefgh', { path: 'notes.txt' }, { ok: true, text: 'hi' });
    collector.recordFinal('done');
    finalizeArchiveExport(collector, {
      stopReason: 'success',
      finalText: 'done',
      steps: 1,
      duration_ms: 5,
      usage: {},
    });

    // Index + exports are separate writers from the run exporter; exercise all.
    rebuildIndex();
    rebuildSpreadsheets();

    const root = archiveRoot();
    assert.ok(fs.existsSync(root), 'archive root should exist after an export');
    const bad = findModeViolations(root);
    assert.equal(bad.length, 0, 'archive artifacts must be 0700/0600:\n' + describeViolations(bad));
  });

  it('transcript, session, ledger, and trace files are private', { skip: skipModes }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-10-runner-'));

    const transcript = new Transcript(path.join(root, 'logs', 'run.jsonl'));
    transcript.append({ type: 'user_prompt', text: 'hello' });
    transcript.flush();
    assert.equal(modeBits(transcript.filePath), FILE_MODE, 'transcript file');
    assert.equal(modeBits(path.dirname(transcript.filePath)), DIR_MODE, 'transcript dir');

    const store = new SessionStore(path.join(root, 'sessions', 'ses.state.json'));
    store.load();
    store.setMessages([{ role: 'user', content: 'hello' }]);
    store.save();
    assert.equal(modeBits(store.filePath), FILE_MODE, 'session state file');
    assert.equal(modeBits(path.dirname(store.filePath)), DIR_MODE, 'session dir');

    const ledger = new SessionLedger(path.join(root, 'sessions', 'ses.state.json'));
    ledger.append('user_prompt', { text: 'hello' });
    assert.equal(modeBits(ledger.filePath), FILE_MODE, 'ledger file');
    assert.equal(modeBits(ledger.cursorPath), FILE_MODE, 'ledger cursor file');

    // Both capture levels that actually write: `redacted` and `full`. A trace at
    // level `full` keeps prompt bodies, so it is the most sensitive of the two
    // and must not be the one that slips.
    for (const level of ['redacted', 'full']) {
      const trace = new JsonlTrace({
        filePath: path.join(root, 'traces', level + '.jsonl'),
        level,
        traceId: 'fd10-trace-' + level,
        layer: 'runner',
      });
      trace.append('run_start', { run_id: 'fd10' });
      assert.equal(modeBits(trace.filePath), FILE_MODE, level + ' trace file');
      assert.equal(modeBits(path.dirname(trace.filePath)), DIR_MODE, 'trace dir');
    }
  });

  it('workspace trust store is private', { skip: skipModes }, () => {
    // workspace-trust resolves its store from HOME rather than
    // BRIDGE_RUNNER_HOME, so this is the one artifact needing a HOME override.
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-10-home-'));
    const realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      // Re-require so userConfigDir() re-reads the overridden HOME.
      delete require.cache[require.resolve('../../src/runner/workspace-trust')];
      const trust = require('../../src/runner/workspace-trust');
      trust.recordTrust('/tmp/some-project');
      const storePath = path.join(fakeHome, '.bridge-runner', 'trust.json');
      assert.ok(fs.existsSync(storePath), 'trust store should have been written');
      assert.equal(modeBits(storePath), FILE_MODE, 'trust.json');
      assert.equal(modeBits(path.dirname(storePath)), DIR_MODE, '.bridge-runner dir');
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
      delete require.cache[require.resolve('../../src/runner/workspace-trust')];
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('recovery run manifest is private', { skip: skipModes }, () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-10-project-'));
    const manifestPath = writeRunManifest(project, {
      runId: 'fd10-manifest',
      sessionId: null,
      model: 'claude-test',
      undoLog: [
        {
          path: 'notes.txt',
          tool: 'write_file',
          backup_path: path.join(project, '.bridge-runner', 'backups', 'notes.txt-1.bak'),
          original_sha256: 'a'.repeat(64),
          new_sha256: 'b'.repeat(64),
        },
      ],
    });

    assert.ok(manifestPath, 'a run that edited a file must leave a manifest');
    assert.equal(modeBits(manifestPath), FILE_MODE, 'manifest.json');
    assert.equal(modeBits(path.dirname(manifestPath)), DIR_MODE, 'manifest run dir');
  });

  it('does NOT force modes on user project files (P0-12 carve-out)', { skip: skipModes }, () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-10-carveout-'));

    // Compare against a plain fs write in the same directory rather than
    // hard-coding 0644. Asserting "not 0600" would fail spuriously on a machine
    // running `umask 077`, where an ordinary write is already 0600. The real
    // invariant is "a project write behaves like any other write", so the
    // control file is the correct oracle.
    const control = path.join(project, 'control.js');
    fs.writeFileSync(control, 'ordinary\n', 'utf8');

    const writeFile = require('../../src/runner/tools/write-file');
    const result = writeFile.execute(
      { path: 'app.js', content: 'console.log("hi");\n' },
      { cwd: project, cwdRealpath: fs.realpathSync(project) },
    );
    assert.equal(result.ok, true, result.text);

    assert.equal(
      modeBits(path.join(project, 'app.js')),
      modeBits(control),
      'project files must follow umask like a plain write, not runner privacy rules',
    );
  });
});
