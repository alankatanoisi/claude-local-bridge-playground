'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { WorkerRuntime, resolveRunnerBin, packageRootDir } = require('../../src/runner/worker-runtime');
const { evaluateWorkspaceTrust, trustStorePath, loadTrustStore } = require('../../src/runner/workspace-trust');
const { normalizeExposedToolsList } = require('../../src/runner/run');

describe('P0-08 worker confinement', () => {
  it('resolveRunnerBin pins to this package bin, independent of process.cwd()', () => {
    const previous = process.cwd();
    const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-cwd-'));
    try {
      process.chdir(outsider);
      // A malicious project could drop a fake runner in cwd; we must ignore it.
      fs.writeFileSync(path.join(outsider, 'local-bridge-runner.js'), 'console.log("hijack")\n');
      const resolved = resolveRunnerBin();
      assert.equal(resolved, path.join(packageRootDir(), 'bin', 'local-bridge-runner.js'));
      assert.ok(resolved.startsWith(packageRootDir()));
    } finally {
      process.chdir(previous);
    }
  });

  it('resolveRunnerBin rejects binaries outside the package', () => {
    const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-bin-'));
    const fake = path.join(outsider, 'local-bridge-runner.js');
    fs.writeFileSync(fake, 'console.log("nope")\n');
    assert.throws(() => resolveRunnerBin(fake), /outside this package|Refusing worker runner/i);
  });

  it('WorkerRuntime args inherit trust without recording consent', async () => {
    let captured = null;
    const child = {
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, cb) {
        if (event === 'close') setImmediate(() => cb(0));
      },
      kill() {},
    };
    const runtime = new WorkerRuntime({
      spawnDepth: 0,
      spawn(cmd, args) {
        captured = { cmd, args };
        return child;
      },
    });

    await runtime.spawnWorker({
      prompt: 'hello',
      cwd: packageRootDir(),
      allowedTools: ['read_file'],
      maxSteps: 2,
    });

    assert.ok(captured);
    assert.ok(captured.args.includes('--inherit-workspace-trust'));
    assert.ok(!captured.args.includes('--trust-workspace'));
    assert.equal(captured.args[0], resolveRunnerBin());
  });
});

describe('P0-08 inheritTrust does not persist', () => {
  it('evaluateWorkspaceTrust inheritTrust skips trust.json writes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-inh-'));
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;
    try {
      const before = fs.existsSync(trustStorePath()) ? loadTrustStore() : { workspaces: [] };
      const result = await evaluateWorkspaceTrust({
        cwdRealpath: tmp,
        inheritTrust: true,
        quiet: true,
      });
      assert.equal(result.trusted, true);
      assert.equal(result.recorded, false);
      assert.equal(result.reason, 'inherited_trust');
      const after = fs.existsSync(trustStorePath()) ? loadTrustStore() : { workspaces: [] };
      assert.equal(after.workspaces.length, before.workspaces.length);
    } finally {
      process.env.HOME = prevHome;
    }
  });
});

describe('P0-08 Set-shaped allowlists', () => {
  it('normalizeExposedToolsList accepts Set and Array', () => {
    assert.deepEqual(normalizeExposedToolsList(new Set(['read_file', 'glob'])).sort(), ['glob', 'read_file']);
    assert.deepEqual(normalizeExposedToolsList(['search_text']), ['search_text']);
    assert.equal(normalizeExposedToolsList(new Set()), null);
    assert.equal(normalizeExposedToolsList(null), null);
  });
});
