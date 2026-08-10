'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const ALLOWED_EXECUTABLES = new Set(['node', 'npm']);
const SENSITIVE_ENV_NAME = /(^|_)(TOKEN|SECRET|PASSWORD|CREDENTIALS?|API_KEY|PRIVATE_KEY|AUTH(?:ORIZATION)?|COOKIE|SESSION)(_|$)/i;

async function collectTestFailureDocuments({ suiteName, suites, baseRoot, maxOutputBytes = 200000 }) {
  const suite = suites?.[suiteName];
  if (!suite) throw new Error(`unknown test suite '${suiteName}'`);
  validateSuite(suiteName, suite);

  const cwd = path.resolve(baseRoot, suite.cwd || '.');
  assertInsideRoot(path.resolve(baseRoot), cwd, `test suite '${suiteName}' cwd`);
  const execution = await runCommand({
    command: suite.command,
    cwd,
    timeoutMs: suite.timeoutMs || 30000,
    maxOutputBytes,
  });
  const failures = parseTapFailures(`${execution.stdout}\n${execution.stderr}`);

  return {
    suite: suiteName,
    execution,
    documents: failures.map((failure, index) => failureDocument(suiteName, failure, index)),
  };
}

function validateSuite(name, suite) {
  if (!Array.isArray(suite.command) || suite.command.length === 0) {
    throw new Error(`test suite '${name}' requires a command argv array`);
  }
  if (!ALLOWED_EXECUTABLES.has(suite.command[0])) {
    throw new Error(`test suite '${name}' executable '${suite.command[0]}' is not allowlisted`);
  }
  if (suite.command.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    throw new Error(`test suite '${name}' command contains an invalid argument`);
  }
}

function runCommand({ command, cwd, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    const env = buildSafeTestEnvironment(process.env);
    // When our own unit tests exercise this collector, Node sets an internal
    // marker that would make the nested command behave like a test worker.
    // The collected suite must behave exactly like a fresh Terminal command.
    delete env.NODE_TEST_CONTEXT;

    // shell:false is essential: arguments are passed directly to the named
    // executable, so shell operators and substitutions are never interpreted.
    const child = spawn(command[0], command.slice(1), {
      cwd,
      shell: false,
      // A separate process group lets the timeout stop children started by an
      // approved runner such as npm, not only the immediate npm process.
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let truncated = false;
    let timedOut = false;
    let forceTimer = null;

    const capture = (target) => (chunk) => {
      if (capturedBytes >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = maxOutputBytes - capturedBytes;
      const kept = chunk.subarray(0, remaining);
      capturedBytes += kept.length;
      target.push(kept);
      if (kept.length < chunk.length) truncated = true;
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.on('error', reject);

    const timer = setTimeout(() => {
      timedOut = true;
      signalProcessTree(child, 'SIGTERM');
      // A misbehaving test can ignore SIGTERM. Escalate after a short grace
      // period so the configured timeout remains an actual host guarantee.
      forceTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 1000);
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve({
        command: [...command],
        cwd,
        exitCode: code,
        signal,
        timedOut,
        truncated,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

function signalProcessTree(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may have exited between the timeout and this signal.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // A completed process needs no further action.
  }
}

function buildSafeTestEnvironment(source) {
  const env = {};
  for (const [name, value] of Object.entries(source || {})) {
    // Test discovery needs ordinary process settings such as PATH and HOME,
    // but it must not inherit provider tokens or local authentication state.
    if (!SENSITIVE_ENV_NAME.test(name)) env[name] = value;
  }
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  return env;
}

function parseTapFailures(text) {
  const lines = String(text || '').split(/\r?\n/);
  const failures = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^\s*not ok\s+\d+\s+-\s+(.+?)\s*$/);
    if (match) {
      if (current) failures.push(finalizeFailure(current));
      current = { name: match[1].replace(/\s*\{\s*$/, ''), lines: [line] };
      continue;
    }
    if (current) {
      if (/^\s*(?:ok|not ok)\s+\d+\s+-\s+/.test(line) || /^\s*1\.\.\d+/.test(line)) {
        failures.push(finalizeFailure(current));
        current = null;
      } else {
        current.lines.push(line);
      }
    }
  }
  if (current) failures.push(finalizeFailure(current));

  // Nested TAP can repeat a failing subtest at the file-summary level. Keep
  // the first detailed block for each name so one failure becomes one job.
  const byName = new Map();
  for (const failure of failures) if (!byName.has(failure.name)) byName.set(failure.name, failure);
  return [...byName.values()];
}

function finalizeFailure(failure) {
  const excerpt = failure.lines.join('\n').slice(0, 6000);
  const message = excerpt.match(/(?:error|message):\s*['"]?([^\n'"]+)/i)?.[1]?.trim() || failure.name;
  const location = excerpt.match(/(?:file|location):\s*['"]?([^\n'"]+)/i)?.[1]?.trim() || null;
  const failureType = excerpt.match(/failureType:\s*['"]?([^\n'"]+)/i)?.[1]?.trim() || 'test_failure';
  return { name: failure.name, message, location, failureType, excerpt };
}

function failureDocument(suiteName, failure, index) {
  const identity = `${suiteName}\0${failure.name}\0${index}`;
  const id = `test_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
  const text = JSON.stringify(
    {
      suite: suiteName,
      name: failure.name,
      failure_type: failure.failureType,
      message: failure.message,
      location: failure.location,
      excerpt: failure.excerpt,
    },
    null,
    2,
  );
  return {
    id,
    kind: 'test_failure',
    relativePath: `test-failure/${suiteName}/${id}.json`,
    bytes: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    metadata: { suite: suiteName, failure_type: failure.failureType },
    text,
  };
}

function assertInsideRoot(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes prototype root`);
}

module.exports = {
  buildSafeTestEnvironment,
  collectTestFailureDocuments,
  parseTapFailures,
  runCommand,
  validateSuite,
};
