'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RunLedger, atomicWrite } = require('../src/ledger');

// Thermo-nuclear Medium #3: checkpoints and artifacts must be fsync'd the same
// way event appends already are. fsync itself cannot be observed from inside a
// test (we cannot pull the power), so this pins the CONTRACT: the temp file is
// fsync'd before the rename, the parent directory is fsync'd after it, no temp
// file is left behind, and the visible file holds the whole document.
test('atomicWrite fsyncs the temp file and the directory, then leaves only the final file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const synced = [];
  const original = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    // Record what KIND of handle was synced: a regular file or a directory.
    synced.push(fs.fstatSync(fd).isDirectory() ? 'directory' : 'file');
    return original(fd);
  };
  t.after(() => {
    fs.fsyncSync = original;
  });
  const file = path.join(dir, 'state.json');
  atomicWrite(file, { phase: 'completed', results: [1, 2, 3] });
  assert.deepEqual(synced, ['file', 'directory']);
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { phase: 'completed', results: [1, 2, 3] });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("RunLedger.checkpoint and writeArtifact both go through the fsync'd atomic write", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let fileSyncs = 0;
  const original = fs.fsyncSync;
  fs.fsyncSync = (fd) => {
    if (!fs.fstatSync(fd).isDirectory()) fileSyncs += 1;
    return original(fd);
  };
  t.after(() => {
    fs.fsyncSync = original;
  });
  const ledger = new RunLedger(dir);
  ledger.append('run_started', {});
  ledger.writeArtifact('job-1', { summary: 'x' });
  ledger.checkpoint({ phase: 'workers' });
  // one append + one artifact + one checkpoint
  assert.equal(fileSyncs, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).phase, 'workers');
  assert.ok(!fs.readdirSync(dir).some((name) => name.endsWith('.tmp')));
});
