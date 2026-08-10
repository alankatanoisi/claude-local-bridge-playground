'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const automation = require('../scripts/claude-code-fingerprint');

const stableHeaders = {
  accept: 'application/json',
  'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14',
  'anthropic-dangerous-direct-browser-access': 'true',
  'user-agent': 'claude-cli/2.1.223 (external, sdk-cli)',
  'x-app': 'cli',
  'x-stainless-arch': 'arm64',
  'x-stainless-lang': 'js',
  'x-stainless-os': 'MacOS',
  'x-stainless-package-version': '0.94.0',
  'x-stainless-runtime': 'node',
  'x-stainless-runtime-version': 'v26.3.0',
};

function manifest(version = '2.1.223', headers = stableHeaders) {
  return {
    schemaVersion: 1,
    verifiedAt: '2026-08-06',
    claudeCodeVersion: version,
    stableHeaders: { ...headers },
  };
}

function temporaryRecordLocations() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fingerprint-automation-test-'));
  return {
    root,
    localReportDir: path.join(root, 'local-records'),
    recordOptions: {
      repoRoot: root,
      repoLedgerDir: path.join(root, 'docs', 'automation-ledger', 'fingerprint-checks'),
    },
  };
}

function completeDependencies(overrides = {}) {
  return {
    getGitState: async () => ({ branch: 'main', dirty: false }),
    getLocalClaudeVersion: async () => '2.1.223',
    getNpmLatestVersion: async () => '2.1.223',
    captureLocalClaudeFingerprint: async () => ({
      stableHeaders: { ...stableHeaders },
      ignoredBetaFlags: [],
      missingHeaders: [],
    }),
    loadFallbackManifest: () => manifest(),
    ...overrides,
  };
}

describe('fingerprint automation header containment', () => {
  it('keeps only stable allowlisted headers and narrows beta flags', () => {
    const result = automation.sanitizeObservedHeaders({
      ...stableHeaders,
      authorization: 'Bearer secret-that-must-not-survive',
      'x-api-key': 'secret-api-key',
      'x-claude-code-session-id': 'session-private',
      'x-stainless-retry-count': '4',
      'x-stainless-timeout': '600',
      'x-anthropic-billing-header': 'billing-private',
      'anthropic-beta':
        'claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-1m-2025-08-07,fallback-credit-2026-06-01,mid-conversation-system-2026-04-07,effort-2025-11-24',
    });

    assert.deepEqual(result.stableHeaders, stableHeaders);
    assert.deepEqual(result.ignoredBetaFlags, ['mid-conversation-system-2026-04-07', 'effort-2025-11-24']);
    assert.deepEqual(result.missingHeaders, []);
    assert.equal(JSON.stringify(result).includes('secret-that-must-not-survive'), false);
    assert.equal(JSON.stringify(result).includes('session-private'), false);
    assert.equal(JSON.stringify(result).includes('billing-private'), false);
  });

  it('rejects an incomplete capture rather than shrinking the fallback', () => {
    const result = automation.sanitizeObservedHeaders({ 'user-agent': stableHeaders['user-agent'] });
    assert.ok(result.missingHeaders.includes('anthropic-beta'));
    assert.ok(result.missingHeaders.includes('x-stainless-runtime-version'));
  });

  it('loads the checked-in fallback without request-specific fields', () => {
    const checkedIn = automation.loadFallbackManifest();
    assert.equal(checkedIn.claudeCodeVersion, '2.1.223');
    for (const name of checkedIn.stableHeaders ? Object.keys(checkedIn.stableHeaders) : []) {
      assert.ok(automation.STABLE_CAPTURE_HEADERS.includes(name));
      assert.equal(name.startsWith('authorization'), false);
    }
  });

  it('rejects request-shape or unreviewed beta flags in a hand-edited manifest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fingerprint-manifest-test-'));
    const manifestPath = path.join(root, 'fallback.json');
    const unsafeManifest = manifest();
    unsafeManifest.stableHeaders['anthropic-beta'] += ',context-1m-2025-08-07';
    fs.writeFileSync(manifestPath, JSON.stringify(unsafeManifest));

    assert.throws(() => automation.loadFallbackManifest(manifestPath), /request-specific or unreviewed beta/);
  });
});

describe('fingerprint automation drift and due decisions', () => {
  it('distinguishes fallback drift from an out-of-date local release', () => {
    const current = automation.compareFingerprints(manifest(), stableHeaders, '2.1.223', '2.1.224');
    assert.equal(current.fingerprintDrift, false);
    assert.equal(current.releaseDrift, true);
    assert.equal(current.driftDetected, true);

    const changedHeaders = { ...stableHeaders, 'x-stainless-package-version': '0.95.0' };
    const changed = automation.compareFingerprints(manifest(), changedHeaders, '2.1.223', '2.1.223');
    assert.equal(changed.fingerprintDrift, true);
    assert.equal(changed.releaseDrift, false);
    assert.deepEqual(
      changed.headerDifferences.map((difference) => difference.name),
      ['x-stainless-package-version'],
    );
  });

  it('runs after seven days and labels Monday-noon versus catch-up triggers', () => {
    const lastSuccess = { completedAt: '2026-08-03T19:00:00.000Z' };
    const scheduled = automation.dueDecision(lastSuccess, new Date('2026-08-10T19:00:00.000Z'));
    assert.equal(scheduled.due, true);
    assert.equal(scheduled.trigger, 'scheduled');

    const notDue = automation.dueDecision(lastSuccess, new Date('2026-08-09T19:00:00.000Z'));
    assert.equal(notDue.due, false);

    const catchUp = automation.dueDecision(lastSuccess, new Date('2026-08-11T19:00:00.000Z'));
    assert.equal(catchUp.due, true);
    assert.equal(catchUp.trigger, 'catch-up');
  });

  it('treats an unreadable success record as a catch-up check', async () => {
    const locations = temporaryRecordLocations();
    fs.mkdirSync(locations.localReportDir, { recursive: true });
    fs.writeFileSync(path.join(locations.localReportDir, 'last-success.json'), '{broken json');

    const outcome = await automation.runDue({
      now: new Date('2026-08-10T19:00:00.000Z'),
      localReportDir: locations.localReportDir,
      recordOptions: locations.recordOptions,
      dependencies: completeDependencies(),
    });

    assert.equal(outcome.due, true);
    assert.equal(outcome.decision.trigger, 'catch-up');
    assert.match(outcome.result.notes.join(' '), /last-success record was unreadable/);
  });
});

describe('fingerprint automation records and prepare guard', () => {
  it('writes private local records plus one append-only repo ledger entry', async () => {
    const locations = temporaryRecordLocations();
    const result = await automation.runCheck({
      now: new Date('2026-08-10T19:00:00.000Z'),
      localReportDir: locations.localReportDir,
      recordOptions: locations.recordOptions,
      dependencies: completeDependencies(),
    });

    assert.equal(result.actionTaken, 'none');
    assert.ok(fs.existsSync(result.localReportJson));
    assert.ok(fs.existsSync(result.localReportText));
    assert.ok(fs.existsSync(path.join(locations.localReportDir, 'last-run.json')));
    assert.ok(fs.existsSync(path.join(locations.localReportDir, 'last-success.json')));
    assert.ok(fs.existsSync(path.join(locations.root, result.repoLedger)));
    assert.equal(fs.statSync(locations.localReportDir).mode & 0o777, 0o700);

    const ledger = fs.readFileSync(path.join(locations.root, result.repoLedger), 'utf8');
    assert.match(ledger, /Trigger: manual/);
    assert.match(ledger, /Drift detected: no/);
    assert.match(ledger, /intentionally excludes authorization values/);
  });

  it('refuses to edit or validate when the repository already has local changes', async () => {
    const locations = temporaryRecordLocations();
    let wroteManifest = false;
    let ranValidation = false;
    const newerHeaders = {
      ...stableHeaders,
      'user-agent': 'claude-cli/2.1.224 (external, sdk-cli)',
    };

    const result = await automation.runPrepare({
      now: new Date('2026-08-10T19:00:00.000Z'),
      localReportDir: locations.localReportDir,
      recordOptions: locations.recordOptions,
      dependencies: completeDependencies({
        getGitState: async () => ({ branch: 'main', dirty: true }),
        getLocalClaudeVersion: async () => '2.1.224',
        getNpmLatestVersion: async () => '2.1.224',
        captureLocalClaudeFingerprint: async () => ({
          stableHeaders: newerHeaders,
          ignoredBetaFlags: [],
          missingHeaders: [],
        }),
        writeFallbackManifest: () => {
          wroteManifest = true;
        },
        runValidations: async () => {
          ranValidation = true;
          return [];
        },
      }),
    });

    assert.equal(result.actionTaken, 'skipped');
    assert.equal(result.patchPrepared, false);
    assert.equal(wroteManifest, false);
    assert.equal(ranValidation, false);
    assert.match(result.notes.join(' '), /repository already has local changes/);
  });

  it('prepares a clean drift patch on a dated branch without Git history actions', async () => {
    const locations = temporaryRecordLocations();
    const gitCalls = [];
    let writtenVersion = null;
    const newerHeaders = {
      ...stableHeaders,
      'user-agent': 'claude-cli/2.1.224 (external, sdk-cli)',
    };

    const result = await automation.runPrepare({
      now: new Date('2026-08-10T19:00:00.000Z'),
      localReportDir: locations.localReportDir,
      recordOptions: locations.recordOptions,
      dependencies: completeDependencies({
        getLocalClaudeVersion: async () => '2.1.224',
        getNpmLatestVersion: async () => '2.1.224',
        captureLocalClaudeFingerprint: async () => ({
          stableHeaders: newerHeaders,
          ignoredBetaFlags: [],
          missingHeaders: [],
        }),
        refreshCleanMain: async () => ({ ok: true, pulled: false }),
        runFile: async (file, args) => {
          gitCalls.push([file, args]);
          return { ok: true, code: 0, stdout: '' };
        },
        writeFallbackManifest: (_manifest, _headers, version) => {
          writtenVersion = version;
        },
        runValidations: async () => [{ name: 'focused tests', status: 'pass', exitCode: 0 }],
      }),
    });

    assert.equal(result.actionTaken, 'patch prepared');
    assert.equal(result.patchPrepared, true);
    assert.equal(result.patchBranch, 'codex/fingerprint-refresh-2026-08-10');
    assert.equal(result.repoBranch, 'codex/fingerprint-refresh-2026-08-10');
    assert.equal(writtenVersion, '2.1.224');
    assert.deepEqual(gitCalls, [['git', ['switch', '-c', 'codex/fingerprint-refresh-2026-08-10']]]);
    assert.equal(
      gitCalls.flat(2).some((value) => ['commit', 'push', 'merge'].includes(value)),
      false,
    );
  });

  it('uses a lock file to prevent overlapping scheduled runs', () => {
    const locations = temporaryRecordLocations();
    const release = automation.acquireRunLock(locations.localReportDir, new Date('2026-08-10T19:00:00.000Z'));
    assert.throws(
      () => automation.acquireRunLock(locations.localReportDir, new Date('2026-08-10T19:01:00.000Z')),
      /already active/,
    );
    release();
    const secondRelease = automation.acquireRunLock(locations.localReportDir, new Date('2026-08-10T19:02:00.000Z'));
    secondRelease();
  });
});
