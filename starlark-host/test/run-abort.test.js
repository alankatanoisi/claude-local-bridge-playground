'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const { applyFailedRunExitCode } = require('../src/run-abort');

// Low #5 regression: an earlier matrix entry failed, then the current entry
// received SIGTERM. The signal handler already set 143, so the final generic
// failed-runs check must leave that more useful code alone.
test('failed matrix entries do not overwrite a SIGINT or SIGTERM exit code', (t) => {
  const originalExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = originalExitCode;
  });

  for (const signalExitCode of [130, 143]) {
    const controller = new AbortController();
    process.exitCode = signalExitCode;
    controller.abort(new Error(signalExitCode === 130 ? 'SIGINT' : 'SIGTERM'));

    applyFailedRunExitCode(1, controller.signal);

    assert.equal(process.exitCode, signalExitCode);
  }
});

test('an ordinary failed matrix entry still exits with code 1', (t) => {
  const originalExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = originalExitCode;
  });

  process.exitCode = undefined;
  applyFailedRunExitCode(1, new AbortController().signal);
  assert.equal(process.exitCode, 1);
});

for (const [signal, exitCode] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  test(`real matrix command preserves ${signal} after an earlier failed entry`, async (t) => {
    const repo = path.resolve(__dirname, '../..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starlark-matrix-signal-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const preload = path.join(dir, 'controlled-run.cjs');
    fs.writeFileSync(
      preload,
      `
      const { PhasedCoordinator } = require(${JSON.stringify(path.join(repo, 'starlark-host/src/coordinator.js'))});
      let runCount = 0;
      PhasedCoordinator.prototype.run = async function () {
        runCount += 1;
        if (runCount === 1) throw new Error('controlled first matrix failure');
        // Tell the parent that the second run is waiting. Its signal handler
        // is installed now, so the test needs no guessed timer.
        await new Promise((resolve) => {
          // An active timer keeps this controlled child alive while it waits.
          // The signal event clears it immediately; elapsed time decides nothing.
          const keepAlive = setInterval(() => {}, 1000);
          this.signal.addEventListener('abort', () => { clearInterval(keepAlive); resolve(); }, { once: true });
          process.stdout.write('SECOND_RUN_READY\\n');
        });
        this.state.phase = 'aborted';
        return this.state;
      };
    `,
    );
    const child = spawn(
      process.execPath,
      ['--require', preload, 'starlark-host/bin/run-experiment.js', '--mode', 'mock', '--matrix'],
      {
        cwd: repo,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    let stdout = '';
    const finished = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, actualSignal) => resolve({ code, actualSignal }));
    });
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.includes('SECOND_RUN_READY')) resolve();
      });
      child.once('error', reject);
    });
    await ready;
    child.kill(signal);
    const result = await finished;
    assert.equal(result.actualSignal, null);
    assert.equal(result.code, exitCode, stdout);
    assert.match(stdout, /controlled first matrix failure/);
  });
}
