#!/usr/bin/env node
'use strict';

// This command maintains the bridge's *fallback* Claude Code identity without
// touching a real Anthropic endpoint. It deliberately launches the local
// Claude Code binary against a temporary HTTP server bound to 127.0.0.1.

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const { sanitizeBetaList, REQUEST_SPECIFIC_HEADERS } = require('../src/fingerprint');

const REPO_ROOT = path.resolve(__dirname, '..');
const FALLBACK_MANIFEST = path.join(REPO_ROOT, 'src', 'claude-code-fingerprint-fallback.json');
const DEFAULT_LOCAL_REPORT_DIR = path.join(os.homedir(), '.bridge-runner', 'fingerprint-checks');
const REPO_LEDGER_DIR = path.join(REPO_ROOT, 'docs', 'automation-ledger', 'fingerprint-checks');
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT = 64 * 1024;
const MAX_PROBE_BODY_BYTES = 2 * 1024 * 1024;

// These are the only captured values that can be persisted or proposed for
// fallback replay. Authorization, session, retry, timeout, billing, account,
// and body values never enter this list.
const STABLE_CAPTURE_HEADERS = [
  'accept',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'user-agent',
  'x-app',
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
];

// An incomplete capture must never replace a complete fallback. These fields
// are the minimum evidence that the request followed Claude Code's OAuth SDK
// path rather than an unrelated API-client path.
const REQUIRED_CAPTURE_HEADERS = [
  'anthropic-beta',
  'user-agent',
  'x-app',
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
];

// `sanitizeBetaList` preserves the bridge's existing request-shape filtering.
// This second, narrower allowlist prevents a newly observed capability beta
// from silently becoming a global fallback. New beta families require human
// review before they can join this list.
const SAFE_FALLBACK_BETA_PREFIXES = ['claude-code-', 'oauth-', 'interleaved-thinking-'];

function isoFileStamp(now) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function localCalendarDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localDisplayTime(now) {
  const text = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return `${text.replace(',', '')} America/Los_Angeles`;
}

function atomicWrite(filePath, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
    mode: path.dirname(filePath).includes('.bridge-runner') ? 0o700 : 0o755,
  });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' });
  fs.chmodSync(temporaryPath, mode);
  fs.renameSync(temporaryPath, filePath);
}

function atomicCreate(filePath, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' });
    fs.chmodSync(temporaryPath, mode);

    // A hard link fails with EEXIST instead of replacing an existing target.
    // Because the temporary file is in the same directory, this is an atomic
    // create-only handoff on the same filesystem.
    fs.linkSync(temporaryPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      // Keep the original create/link failure authoritative. The temporary
      // filename contains no user data and can be cleaned manually if needed.
      if (cleanupError.code !== 'ENOENT') error.temporaryCleanupFailed = true;
    }
    throw error;
  }
  fs.unlinkSync(temporaryPath);
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function acquireRunLock(localReportDir = DEFAULT_LOCAL_REPORT_DIR, now = new Date()) {
  fs.mkdirSync(localReportDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(localReportDir, 0o700);
  const lockPath = path.join(localReportDir, 'run.lock');

  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: now.toISOString() })}\n`);
    fs.closeSync(descriptor);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;

    // A six-hour-old lock cannot belong to a healthy 30-second probe. Remove
    // only this exact automation-owned lock file, then retry once.
    const ageMs = now.getTime() - fs.statSync(lockPath).mtimeMs;
    if (ageMs <= 6 * 60 * 60 * 1000) {
      throw new Error('Another fingerprint automation run is already active.');
    }
    fs.unlinkSync(lockPath);
    return acquireRunLock(localReportDir, now);
  }

  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  };
}

function runFile(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd || REPO_ROOT,
        env: options.env || process.env,
        encoding: 'utf8',
        timeout: options.timeout || COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_COMMAND_OUTPUT,
      },
      (error, stdout) => {
        resolve({
          ok: !error,
          code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
          stdout: typeof stdout === 'string' ? stdout.trim() : '',
        });
      },
    );
  });
}

function parseSemanticVersion(value, label) {
  const match = String(value || '').match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/);
  if (!match) throw new Error(`${label} did not return a recognizable version number.`);
  return match[1];
}

async function getLocalClaudeVersion(run = runFile) {
  const result = await run('claude', ['--version']);
  if (!result.ok) throw new Error('The local `claude --version` check failed.');
  return parseSemanticVersion(result.stdout, 'Claude Code');
}

async function getNpmLatestVersion(run = runFile) {
  const result = await run('npm', ['view', '@anthropic-ai/claude-code', 'version', '--json']);
  if (!result.ok) throw new Error('The npm registry version check failed.');

  // npm normally returns a JSON string. The semantic-version parser is kept
  // as a fallback so minor npm output-format differences do not break checks.
  try {
    return parseSemanticVersion(JSON.parse(result.stdout), 'npm');
  } catch {
    return parseSemanticVersion(result.stdout, 'npm');
  }
}

function normalizeHeaderValue(value) {
  const text = Array.isArray(value) ? value.join(',') : String(value || '');
  if (!text || text.length > 2048 || /[\r\n\0]/.test(text)) return null;
  return text.trim();
}

function sanitizeObservedHeaders(rawHeaders) {
  const normalized = {};
  for (const [name, value] of Object.entries(rawHeaders || {})) {
    normalized[name.toLowerCase()] = value;
  }

  const stableHeaders = {};
  const ignoredBetaFlags = [];

  for (const name of STABLE_CAPTURE_HEADERS) {
    const value = normalizeHeaderValue(normalized[name]);
    if (!value) continue;

    if (name === 'anthropic-beta') {
      // First apply the runtime's existing request-shape filter.
      const runtimeSanitized = sanitizeBetaList(value);
      const flags = runtimeSanitized ? runtimeSanitized.split(',').map((flag) => flag.trim()) : [];
      const allowed = flags.filter((flag) => SAFE_FALLBACK_BETA_PREFIXES.some((prefix) => flag.startsWith(prefix)));
      ignoredBetaFlags.push(...flags.filter((flag) => !allowed.includes(flag)));
      if (allowed.length > 0) stableHeaders[name] = allowed.join(',');
      continue;
    }

    stableHeaders[name] = value;
  }

  const missingHeaders = REQUIRED_CAPTURE_HEADERS.filter((name) => !stableHeaders[name]);
  return { stableHeaders, ignoredBetaFlags, missingHeaders };
}

function sendMockMessagesResponse(response) {
  // Claude Code uses streaming Messages requests. This tiny valid SSE response
  // lets the local process finish normally after the headers are captured.
  const events = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_local_fingerprint_probe',
          type: 'message',
          role: 'assistant',
          model: 'claude-local-fingerprint-probe',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
    ],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    ],
    ['message_stop', { type: 'message_stop' }],
  ];
  const body = `${events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n`).join('\n')}\n`;
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'close',
  });
  response.end(body);
}

function drainRequest(request, onComplete) {
  let bytes = 0;
  request.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_PROBE_BODY_BYTES) request.destroy();
  });
  request.on('end', onComplete);
}

async function captureLocalClaudeFingerprint(options = {}) {
  const claudeBin = options.claudeBin || 'claude';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-fingerprint-'));
  const configDir = path.join(tempDir, 'claude-config');
  fs.mkdirSync(configDir, { mode: 0o700 });

  let child = null;
  let server = null;

  try {
    let resolveCapture;
    let rejectCapture;
    const captured = new Promise((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;
    });

    server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;

      drainRequest(request, () => {
        if (pathname === '/v1/messages') {
          const sanitized = sanitizeObservedHeaders(request.headers);
          sendMockMessagesResponse(response);
          resolveCapture(sanitized);
          return;
        }

        if (pathname.endsWith('/count_tokens')) {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ input_tokens: 1 }));
          return;
        }

        // Nonessential telemetry and discovery requests receive an empty local
        // response. Nothing from this mock is forwarded to another host.
        response.writeHead(204);
        response.end();
      });
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    const childEnvironment = {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
      ANTHROPIC_AUTH_TOKEN: 'dummy-local-fingerprint-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'dummy-local-fingerprint-token',
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    };

    // Remove alternate auth/provider routes from the child environment. The
    // dummy OAuth value above is the only credential the probe should see.
    for (const name of [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
    ]) {
      delete childEnvironment[name];
    }

    const args = [
      '--safe-mode',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--tools',
      '',
      '--permission-mode',
      'plan',
      '--output-format',
      'json',
      '--print',
      'Reply with only OK.',
    ];

    child = spawn(claudeBin, args, {
      cwd: tempDir,
      env: childEnvironment,
      shell: false,
      stdio: 'ignore',
    });

    child.once('error', () => rejectCapture(new Error('The local Claude Code process could not start.')));
    child.once('exit', () => {
      rejectCapture(new Error('Claude Code exited before a fingerprint request was captured.'));
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error('Timed out waiting for Claude Code to reach the localhost mock.')),
        COMMAND_TIMEOUT_MS,
      ).unref();
    });
    const result = await Promise.race([captured, timeout]);

    // Give Claude Code a short opportunity to consume the mock response and
    // exit. If it remains alive, terminate only this exact child process.
    if (child.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
    if (child.exitCode === null) child.kill('SIGTERM');

    if (result.missingHeaders.length > 0) {
      throw new Error(`The localhost capture was incomplete; missing ${result.missingHeaders.join(', ')}.`);
    }
    return result;
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    // tempDir was created by this function with mkdtemp, so this exact cleanup
    // cannot target a user-selected directory or repository path.
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function loadFallbackManifest(filePath = FALLBACK_MANIFEST) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (manifest.schemaVersion !== 1 || typeof manifest.stableHeaders !== 'object') {
    throw new Error('The fallback fingerprint manifest has an unsupported shape.');
  }

  for (const name of Object.keys(manifest.stableHeaders)) {
    if (!STABLE_CAPTURE_HEADERS.includes(name)) {
      throw new Error(`The fallback manifest contains a non-allowlisted header: ${name}`);
    }
    if (REQUEST_SPECIFIC_HEADERS.has(name)) {
      throw new Error(`The fallback manifest contains request-specific state: ${name}`);
    }
  }

  const missing = REQUIRED_CAPTURE_HEADERS.filter((name) => !manifest.stableHeaders[name]);
  if (missing.length > 0) throw new Error(`The fallback manifest is missing ${missing.join(', ')}.`);

  // The structured file is editable, so validate its beta policy again at
  // load time. This keeps a hand-edited capability or request-shape beta from
  // bypassing the capture-time filters.
  const betaValue = manifest.stableHeaders['anthropic-beta'];
  const sanitizedBetaValue = sanitizeBetaList(betaValue);
  const betaFlags = betaValue.split(',').map((flag) => flag.trim());
  const hasUnreviewedBeta = betaFlags.some(
    (flag) => !SAFE_FALLBACK_BETA_PREFIXES.some((prefix) => flag.startsWith(prefix)),
  );
  if (sanitizedBetaValue !== betaValue || hasUnreviewedBeta) {
    throw new Error('The fallback manifest contains a request-specific or unreviewed beta flag.');
  }

  const userAgentVersion = parseSemanticVersion(manifest.stableHeaders['user-agent'], 'fallback user-agent');
  if (userAgentVersion !== manifest.claudeCodeVersion) {
    throw new Error('The fallback manifest version does not match its user-agent.');
  }
  return manifest;
}

function compareFingerprints(manifest, observedHeaders, localVersion, npmLatestVersion) {
  const names = [...new Set([...Object.keys(manifest.stableHeaders), ...Object.keys(observedHeaders)])].sort();
  const headerDifferences = names
    .filter((name) => manifest.stableHeaders[name] !== observedHeaders[name])
    .map((name) => ({ name, repo: manifest.stableHeaders[name] || null, observed: observedHeaders[name] || null }));

  return {
    headerDifferences,
    fingerprintDrift: headerDifferences.length > 0 || manifest.claudeCodeVersion !== localVersion,
    releaseDrift: localVersion !== npmLatestVersion,
    driftDetected:
      headerDifferences.length > 0 || manifest.claudeCodeVersion !== localVersion || localVersion !== npmLatestVersion,
  };
}

function dueDecision(lastSuccess, now = new Date()) {
  const completedAt = lastSuccess?.completedAt ? Date.parse(lastSuccess.completedAt) : NaN;
  const ageMs = Number.isFinite(completedAt) ? now.getTime() - completedAt : Infinity;
  if (ageMs < CHECK_INTERVAL_MS) return { due: false, ageMs, trigger: null };

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );

  // A periodic invocation near Monday noon is labelled scheduled. Any other
  // overdue invocation is a catch-up run, which covers sleep and closed-lid time.
  const trigger = weekday === 'Mon' && hour >= 12 && hour < 16 ? 'scheduled' : 'catch-up';
  return { due: true, ageMs, trigger };
}

async function getGitState(run = runFile) {
  const [root, branch, status] = await Promise.all([
    run('git', ['rev-parse', '--show-toplevel']),
    run('git', ['branch', '--show-current']),
    run('git', ['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  if (!root.ok || path.resolve(root.stdout) !== REPO_ROOT)
    throw new Error('The automation is not running in the expected repository.');
  if (!branch.ok || !branch.stdout) throw new Error('The current Git branch could not be determined.');
  if (!status.ok) throw new Error('The Git working-tree status could not be determined.');
  return { branch: branch.stdout, dirty: status.stdout.length > 0 };
}

async function refreshCleanMain(run = runFile) {
  const fetch = await run('git', ['fetch', 'origin', 'main']);
  if (!fetch.ok) return { ok: false, note: 'Fetching origin/main failed; no source files were edited.' };

  const relation = await run('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main']);
  if (!relation.ok) return { ok: false, note: 'The relationship to origin/main could not be determined.' };
  const [localAhead, remoteAhead] = relation.stdout.split(/\s+/).map(Number);

  if (localAhead > 0 && remoteAhead > 0) {
    return { ok: false, note: 'Local main and origin/main have diverged; manual Git review is required.' };
  }
  if (remoteAhead > 0) {
    const pull = await run('git', ['pull', '--ff-only', 'origin', 'main']);
    if (!pull.ok) return { ok: false, note: 'The clean main branch could not be fast-forwarded.' };
    return { ok: true, pulled: true };
  }
  return { ok: true, pulled: false };
}

function writeFallbackManifest(manifest, observedHeaders, localVersion, now, filePath = FALLBACK_MANIFEST) {
  const orderedHeaders = {};
  for (const name of STABLE_CAPTURE_HEADERS) {
    if (observedHeaders[name]) orderedHeaders[name] = observedHeaders[name];
  }
  const updated = {
    schemaVersion: manifest.schemaVersion,
    verifiedAt: localCalendarDate(now),
    claudeCodeVersion: localVersion,
    stableHeaders: orderedHeaders,
  };
  atomicWrite(filePath, `${JSON.stringify(updated, null, 2)}\n`, 0o644);
  return updated;
}

function baseResult({ mode, trigger, now, gitState, manifest }) {
  return {
    schemaVersion: 1,
    automation: 'Claude Code fingerprint check',
    startedAt: now.toISOString(),
    completedAt: null,
    displayTime: localDisplayTime(now),
    trigger,
    mode,
    repoRoot: REPO_ROOT,
    repoBranch: gitState?.branch || 'unknown',
    repoWasDirty: gitState?.dirty ?? null,
    localClaudeVersion: null,
    npmLatestClaudeCodeVersion: null,
    repoFallbackVersionBefore: manifest?.claudeCodeVersion || null,
    driftDetected: null,
    fingerprintDrift: null,
    releaseDrift: null,
    headerDifferences: [],
    sanitizedObservedStableHeaders: {},
    ignoredBetaFlags: [],
    actionTaken: 'none',
    patchBranch: null,
    changedFiles: [],
    validation: [],
    skippedChecks: [],
    notes: [],
    checkCompleted: false,
    patchPrepared: false,
    localReportJson: null,
    localReportText: null,
    repoLedger: null,
  };
}

async function gatherEvidence({ mode, trigger, now, dependencies = {} }) {
  const getGit = dependencies.getGitState || getGitState;
  const getLocal = dependencies.getLocalClaudeVersion || getLocalClaudeVersion;
  const getLatest = dependencies.getNpmLatestVersion || getNpmLatestVersion;
  const capture = dependencies.captureLocalClaudeFingerprint || captureLocalClaudeFingerprint;
  const loadManifest = dependencies.loadFallbackManifest || loadFallbackManifest;

  let gitState = null;
  let manifest = null;
  try {
    gitState = await getGit();
  } catch {
    // The final report still records this failure without retaining command output.
  }
  try {
    manifest = loadManifest();
  } catch {
    // The error is summarized below; raw source or command output is not persisted.
  }

  const result = baseResult({ mode, trigger, now, gitState, manifest });
  if (!gitState) result.notes.push('Repository preflight failed.');
  if (!manifest) result.notes.push('The fallback manifest could not be loaded or validated.');

  try {
    result.localClaudeVersion = await getLocal();
  } catch (error) {
    result.notes.push(error.message);
  }
  try {
    result.npmLatestClaudeCodeVersion = await getLatest();
  } catch (error) {
    result.notes.push(error.message);
  }
  try {
    const captured = await capture();
    result.sanitizedObservedStableHeaders = captured.stableHeaders;
    result.ignoredBetaFlags = captured.ignoredBetaFlags;
  } catch (error) {
    result.notes.push(error.message);
  }

  if (
    manifest &&
    result.localClaudeVersion &&
    result.npmLatestClaudeCodeVersion &&
    Object.keys(result.sanitizedObservedStableHeaders).length > 0
  ) {
    const comparison = compareFingerprints(
      manifest,
      result.sanitizedObservedStableHeaders,
      result.localClaudeVersion,
      result.npmLatestClaudeCodeVersion,
    );
    Object.assign(result, comparison);
    result.checkCompleted = true;
  }

  return { result, gitState, manifest };
}

function validationSummary(validation) {
  if (!validation || validation.length === 0) return 'skipped';
  const passed = validation.filter((item) => item.status === 'pass').length;
  const failed = validation.filter((item) => item.status === 'fail').length;
  const skipped = validation.filter((item) => item.status === 'skipped').length;
  return `${passed} passed, ${failed} failed, ${skipped} skipped`;
}

function renderTextReport(result) {
  const changed = result.changedFiles.length > 0 ? result.changedFiles.join(', ') : 'none';
  const notes = result.notes.length > 0 ? result.notes.join(' ') : 'No additional notes.';
  const drift = result.driftDetected === null ? 'unknown' : result.driftDetected ? 'yes' : 'no';
  const headerLines = Object.entries(result.sanitizedObservedStableHeaders)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n');
  const validationLines =
    result.validation.length > 0
      ? result.validation.map((item) => `  ${item.status.toUpperCase()}: ${item.name}`).join('\n')
      : '  SKIPPED: no patch validation was required';

  return (
    `Claude Code fingerprint automation\n\n` +
    `Time: ${result.displayTime}\n` +
    `Trigger: ${result.trigger}\n` +
    `Mode: ${result.mode}\n` +
    `Repo branch: ${result.repoBranch}\n` +
    `Local Claude Code version: ${result.localClaudeVersion || 'unavailable'}\n` +
    `npm latest Claude Code version: ${result.npmLatestClaudeCodeVersion || 'unavailable'}\n` +
    `Repo fallback version before run: ${result.repoFallbackVersionBefore || 'unavailable'}\n` +
    `Drift detected: ${drift}\n` +
    `Action taken: ${result.actionTaken}\n` +
    `Patch branch: ${result.patchBranch || 'none'}\n` +
    `Files changed by automation: ${changed}\n` +
    `Validation: ${validationSummary(result.validation)}\n` +
    `Notes: ${notes}\n\n` +
    `Sanitized stable headers only:\n${headerLines || '  unavailable'}\n\n` +
    `Validation details:\n${validationLines}\n`
  );
}

function renderLedgerEntry(result) {
  const changed = result.changedFiles.length > 0 ? result.changedFiles.join(', ') : 'none';
  const notes = result.notes.length > 0 ? result.notes.join(' ') : 'No additional notes.';
  const drift = result.driftDetected === null ? 'unknown' : result.driftDetected ? 'yes' : 'no';
  return (
    `# ${result.displayTime}\n\n` +
    `- Automation: Claude Code fingerprint check\n` +
    `- Trigger: ${result.trigger}\n` +
    `- Mode: ${result.mode}\n` +
    `- Repo branch: ${result.repoBranch}\n` +
    `- Local Claude Code version: ${result.localClaudeVersion || 'unavailable'}\n` +
    `- npm latest Claude Code version: ${result.npmLatestClaudeCodeVersion || 'unavailable'}\n` +
    `- Repo fallback version before run: ${result.repoFallbackVersionBefore || 'unavailable'}\n` +
    `- Drift detected: ${drift}\n` +
    `- Action taken: ${result.actionTaken}\n` +
    `- Files changed: ${changed}\n` +
    `- Validation: ${validationSummary(result.validation)}\n` +
    `- Local report: ${result.localReportJson || 'unavailable'}\n` +
    `- Notes: ${notes}\n\n` +
    `This entry intentionally excludes authorization values, OAuth tokens, request bodies, billing values, and account/session identifiers.\n`
  );
}

function allocateRecordPaths(result, localReportDir, now, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const repoLedgerDir = options.repoLedgerDir || REPO_LEDGER_DIR;
  const stamp = isoFileStamp(now);
  result.localReportJson = path.join(localReportDir, `${stamp}-${result.mode}.json`);
  result.localReportText = path.join(localReportDir, `${stamp}-${result.mode}.txt`);
  result.repoLedger = path.relative(repoRoot, path.join(repoLedgerDir, `${stamp}-${result.mode}.md`));
}

function writeRecords(result, localReportDir = DEFAULT_LOCAL_REPORT_DIR, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  fs.mkdirSync(localReportDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(localReportDir, 0o700);

  atomicCreate(result.localReportJson, `${JSON.stringify(result, null, 2)}\n`, 0o600);
  atomicCreate(result.localReportText, renderTextReport(result), 0o600);
  atomicWrite(path.join(localReportDir, 'last-run.json'), `${JSON.stringify(result, null, 2)}\n`, 0o600);

  // Write the canonical project entry before advancing last-success. If this
  // step fails, the due wrapper will try the real check again later instead of
  // treating an incompletely recorded run as finished.
  atomicCreate(path.join(repoRoot, result.repoLedger), renderLedgerEntry(result), 0o644);

  if (result.checkCompleted) {
    const success = {
      schemaVersion: 1,
      completedAt: result.completedAt,
      driftDetected: result.driftDetected,
      localClaudeVersion: result.localClaudeVersion,
      localReportJson: result.localReportJson,
      repoLedger: result.repoLedger,
    };
    atomicWrite(path.join(localReportDir, 'last-success.json'), `${JSON.stringify(success, null, 2)}\n`, 0o600);
  }
}

async function runValidations(run = runFile, includeFullTests = true) {
  const checks = [
    {
      name: 'focused fingerprint tests',
      file: 'node',
      args: [
        '--require',
        './test/setup.js',
        '--test',
        'test/fingerprint-automation.test.js',
        'test/bridge.test.js',
        'test/p1-06-fingerprint-containment.test.js',
      ],
    },
    { name: 'lint', file: 'npm', args: ['run', 'lint'] },
    { name: 'documentation checks', file: 'npm', args: ['run', 'check:docs'] },
    {
      name: 'focused formatting',
      file: 'npx',
      args: ['prettier', '--check', 'src/claude-code-fingerprint-fallback.json'],
    },
    { name: 'Git whitespace check', file: 'git', args: ['diff', '--check'] },
  ];
  if (includeFullTests) checks.push({ name: 'full test suite', file: 'npm', args: ['test'] });

  const results = [];
  for (const check of checks) {
    const outcome = await run(check.file, check.args);
    results.push({ name: check.name, status: outcome.ok ? 'pass' : 'fail', exitCode: outcome.code });
  }
  if (!includeFullTests)
    results.push({ name: 'full test suite', status: 'skipped', reason: 'Explicit --skip-full-tests option.' });
  return results;
}

async function finalizeResult(result, now, localReportDir, recordOptions = {}) {
  result.completedAt = new Date().toISOString();
  allocateRecordPaths(result, localReportDir, now, recordOptions);
  if (!result.changedFiles.includes(result.repoLedger)) result.changedFiles.push(result.repoLedger);
  writeRecords(result, localReportDir, recordOptions);
  return result;
}

async function runCheck(options = {}) {
  const now = options.now || new Date();
  const localReportDir = options.localReportDir || DEFAULT_LOCAL_REPORT_DIR;
  const gathered = await gatherEvidence({
    mode: 'check',
    trigger: options.trigger || 'manual',
    now,
    dependencies: options.dependencies,
  });
  const result = gathered.result;
  if (Array.isArray(options.initialNotes)) result.notes.push(...options.initialNotes);
  result.actionTaken = result.checkCompleted && result.driftDetected ? 'report only' : 'none';
  if (result.ignoredBetaFlags.length > 0) {
    result.notes.push(
      'Capability-specific or unreviewed beta flags were observed but excluded from fallback comparison.',
    );
  }
  return finalizeResult(result, now, localReportDir, options.recordOptions);
}

async function runPrepare(options = {}) {
  const now = options.now || new Date();
  const localReportDir = options.localReportDir || DEFAULT_LOCAL_REPORT_DIR;
  const dependencies = options.dependencies || {};
  const gathered = await gatherEvidence({ mode: 'prepare', trigger: options.trigger || 'manual', now, dependencies });
  const { result, gitState } = gathered;

  if (!result.checkCompleted) {
    result.actionTaken = 'skipped';
    result.notes.push('The evidence check was incomplete, so no patch was attempted.');
    result.skippedChecks.push('patch preparation and validation');
    return finalizeResult(result, now, localReportDir, options.recordOptions);
  }
  if (!gitState || gitState.dirty) {
    result.actionTaken = 'skipped';
    result.notes.push('Auto-fix was skipped because the repository already has local changes.');
    result.skippedChecks.push('patch preparation and validation');
    return finalizeResult(result, now, localReportDir, options.recordOptions);
  }
  if (!result.driftDetected) {
    result.notes.push('The local capture, npm latest release, and repo fallback are congruent.');
    result.skippedChecks.push('patch validation because no patch was needed');
    return finalizeResult(result, now, localReportDir, options.recordOptions);
  }
  if (result.releaseDrift) {
    result.actionTaken = 'skipped';
    result.notes.push(
      'The installed Claude Code version is not npm latest; update the local binary and rerun before preparing a fallback patch.',
    );
    result.skippedChecks.push('patch preparation and validation');
    return finalizeResult(result, now, localReportDir, options.recordOptions);
  }

  const run = dependencies.runFile || runFile;
  let currentBranch = gitState.branch;
  if (currentBranch === 'main') {
    const refresh = await (dependencies.refreshCleanMain || refreshCleanMain)(run);
    if (!refresh.ok) {
      result.actionTaken = 'skipped';
      result.notes.push(refresh.note);
      result.skippedChecks.push('patch preparation and validation');
      return finalizeResult(result, now, localReportDir, options.recordOptions);
    }

    // A fast-forward may have updated the fallback while this run was
    // gathering evidence, so compare again before creating a branch.
    const refreshedManifest = (dependencies.loadFallbackManifest || loadFallbackManifest)();
    result.repoFallbackVersionBefore = refreshedManifest.claudeCodeVersion;
    Object.assign(
      result,
      compareFingerprints(
        refreshedManifest,
        result.sanitizedObservedStableHeaders,
        result.localClaudeVersion,
        result.npmLatestClaudeCodeVersion,
      ),
    );
    if (!result.fingerprintDrift) {
      result.actionTaken = 'none';
      result.notes.push('origin/main already contains a congruent fallback; no patch was needed.');
      return finalizeResult(result, now, localReportDir, options.recordOptions);
    }

    const branchName = `codex/fingerprint-refresh-${localCalendarDate(now)}`;
    const switched = await run('git', ['switch', '-c', branchName]);
    if (!switched.ok) {
      result.actionTaken = 'skipped';
      result.patchBranch = branchName;
      result.notes.push('The recommended patch branch could not be created; no source file was edited.');
      result.skippedChecks.push('patch preparation and validation');
      return finalizeResult(result, now, localReportDir, options.recordOptions);
    }
    currentBranch = branchName;
    result.patchBranch = branchName;
    result.repoBranch = branchName;
  } else {
    const expectedBranch = `codex/fingerprint-refresh-${localCalendarDate(now)}`;
    if (currentBranch !== expectedBranch) {
      result.actionTaken = 'skipped';
      result.patchBranch = expectedBranch;
      result.notes.push(
        `Prepare mode only edits main via a new ${expectedBranch} branch, or that exact existing branch.`,
      );
      result.skippedChecks.push('patch preparation and validation');
      return finalizeResult(result, now, localReportDir, options.recordOptions);
    }
    result.patchBranch = currentBranch;
  }

  const manifest = (dependencies.loadFallbackManifest || loadFallbackManifest)();
  (dependencies.writeFallbackManifest || writeFallbackManifest)(
    manifest,
    result.sanitizedObservedStableHeaders,
    result.localClaudeVersion,
    now,
  );
  result.actionTaken = 'patch prepared';
  result.patchPrepared = true;
  result.changedFiles.push('src/claude-code-fingerprint-fallback.json');
  result.validation = await (dependencies.runValidations || runValidations)(run, options.includeFullTests !== false);
  if (result.validation.some((item) => item.status === 'fail')) {
    result.notes.push('The patch remains uncommitted for manual review because one or more validations failed.');
  } else {
    result.notes.push(
      'The patch and validation report are ready for manual review; nothing was committed, pushed, or merged.',
    );
  }
  return finalizeResult(result, now, localReportDir, options.recordOptions);
}

async function runDue(options = {}) {
  const now = options.now || new Date();
  const localReportDir = options.localReportDir || DEFAULT_LOCAL_REPORT_DIR;
  let lastSuccess = null;
  const initialNotes = [];
  try {
    lastSuccess = readJsonIfPresent(path.join(localReportDir, 'last-success.json'));
  } catch {
    // Corrupt due state must lead to a fresh check. It must not permanently
    // suppress the schedule or be mistaken for a recent success.
    initialNotes.push('The previous last-success record was unreadable, so this run was treated as catch-up.');
  }
  const decision = dueDecision(lastSuccess, now);
  if (initialNotes.length > 0 && decision.due) decision.trigger = 'catch-up';
  if (!decision.due) return { due: false, decision };
  const result = await runCheck({ ...options, now, localReportDir, trigger: decision.trigger, initialNotes });
  return { due: true, decision, result };
}

function parseCliArgs(argv) {
  const mode = argv[0] || 'check';
  if (!['check', 'due', 'prepare'].includes(mode)) {
    throw new Error('Mode must be one of: check, due, prepare.');
  }
  const triggerOption = argv.find((arg) => arg.startsWith('--trigger='));
  const trigger = triggerOption ? triggerOption.slice('--trigger='.length) : 'manual';
  if (!['manual', 'scheduled', 'catch-up'].includes(trigger)) {
    throw new Error('Trigger must be one of: manual, scheduled, catch-up.');
  }
  return { mode, trigger, includeFullTests: !argv.includes('--skip-full-tests') };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const releaseLock = acquireRunLock(DEFAULT_LOCAL_REPORT_DIR);
  let output;
  try {
    if (options.mode === 'due') output = await runDue(options);
    else if (options.mode === 'prepare') output = await runPrepare(options);
    else output = await runCheck(options);
  } finally {
    releaseLock();
  }

  if (options.mode === 'due' && !output.due) {
    // LaunchAgent stdout is a file, so remain quiet on the frequent no-op path.
    if (process.stdout.isTTY) console.log('Fingerprint check is not due yet.');
    return 0;
  }

  const result = options.mode === 'due' ? output.result : output;
  console.log(`Fingerprint automation finished: ${result.actionTaken}`);
  console.log(`Local report: ${result.localReportJson}`);
  console.log(`Repo ledger: ${path.join(REPO_ROOT, result.repoLedger)}`);
  return result.checkCompleted ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      // Error messages are intentionally short; child-process stderr and all
      // credentials are excluded from this user-visible sink.
      console.error(`Fingerprint automation failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  CHECK_INTERVAL_MS,
  DEFAULT_LOCAL_REPORT_DIR,
  FALLBACK_MANIFEST,
  REQUIRED_CAPTURE_HEADERS,
  SAFE_FALLBACK_BETA_PREFIXES,
  STABLE_CAPTURE_HEADERS,
  acquireRunLock,
  captureLocalClaudeFingerprint,
  compareFingerprints,
  dueDecision,
  getLocalClaudeVersion,
  getNpmLatestVersion,
  loadFallbackManifest,
  localCalendarDate,
  parseCliArgs,
  renderLedgerEntry,
  renderTextReport,
  runCheck,
  runDue,
  runPrepare,
  sanitizeObservedHeaders,
  writeFallbackManifest,
  writeRecords,
};
