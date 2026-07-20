'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { narrowChildAuthority } = require('./authority');

const DEFAULT_CHILD_TOOLS = Object.freeze([
  'list_files',
  'read_file',
  'search_text',
  'glob',
  'git_status',
  'manage_tasks',
  'ask_user_question',
]);

const WORKER_STATES = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  KILLED: 'killed',
});

function packageRootDir() {
  // src/runner → package root (…/claude-local-bridge-playground)
  return fs.realpathSync(path.join(__dirname, '../..'));
}

/**
 * Resolve the worker CLI so a malicious --cwd cannot swap which runner code
 * executes. The binary must realpath to this package's bin/local-bridge-runner.js
 * (or, for explicit test overrides, stay under the package root with that name).
 */
function resolveRunnerBin(override) {
  const packageRoot = packageRootDir();
  const expected = path.join(packageRoot, 'bin', 'local-bridge-runner.js');
  const candidate = override ? path.resolve(override) : expected;
  let real;
  try {
    real = fs.realpathSync(candidate);
  } catch (err) {
    throw new Error('Worker runner binary missing: ' + candidate + ' (' + err.message + ')');
  }
  if (real === expected) return real;
  const underPackage = real.startsWith(packageRoot + path.sep) || real === packageRoot;
  if (!underPackage || path.basename(real) !== 'local-bridge-runner.js') {
    throw new Error('Refusing worker runner binary outside this package (cwd must not choose the executable): ' + real);
  }
  return real;
}

function makeWorkerId(prefix = 'wrk') {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

class WorkerRuntime {
  constructor(options = {}) {
    this.runnerBin = resolveRunnerBin(options.runnerBin);
    this.workers = new Map();
    this.spawnDepth = options.spawnDepth || 0;
    // Injectable for tests so we can assert argv without launching a child.
    this._spawn = options.spawn || spawn;
  }

  spawnWorker(spec, options = {}) {
    const workerId = makeWorkerId();
    const phase = spec.phase || 'research';
    const requestedList = Array.isArray(spec.allowedTools) ? spec.allowedTools : [...DEFAULT_CHILD_TOOLS];

    // WP2: intersect the child's requested authority with the parent's
    // immutable ceiling (options.parentCeiling). Children may only narrow:
    // requested flags AND parent flags; requested tools ∩ ceiling tools.
    const authority = narrowChildAuthority(options.parentCeiling || null, {
      allowShell: !!(requestedList.includes('bash') && options.allowShell),
      acceptEdits: !!(spec.acceptEdits && options.acceptEdits),
      dontAsk: !!(spec.dontAsk && options.dontAsk),
      tools: requestedList,
    });
    const allowedList = authority.tools || requestedList;
    const allowed = allowedList.join(',');

    // Inherit this-run trust only — never --trust-workspace, which would write
    // ~/.bridge-runner/trust.json as if the child collected human consent.
    const args = [
      this.runnerBin,
      '--cwd',
      spec.cwd,
      '--output-format',
      'json',
      '--max-steps',
      String(spec.maxSteps || 6),
      '--allowed-tools',
      allowed,
      '--log-level',
      'quiet',
      '--inherit-workspace-trust',
    ];

    if (authority.allowShell) args.push('--allow-shell');
    if (authority.acceptEdits) args.push('--accept-edits');
    if (authority.dontAsk) args.push('--dont-ask');
    if (typeof spec.budgetRemaining?.input_tokens === 'number') {
      args.push('--budget-input-tokens', String(spec.budgetRemaining.input_tokens));
    }
    if (typeof spec.budgetRemaining?.output_tokens === 'number') {
      args.push('--budget-output-tokens', String(spec.budgetRemaining.output_tokens));
    }
    args.push(spec.prompt);

    const record = {
      workerId,
      phase,
      state: WORKER_STATES.RUNNING,
      startedAt: Date.now(),
      spec,
    };
    this.workers.set(workerId, record);

    return new Promise((resolve) => {
      const child = this._spawn(process.execPath, args, {
        cwd: spec.cwd,
        env: { ...process.env, BRIDGE_RUNNER_SPAWN_DEPTH: String(this.spawnDepth + 1), ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => {
        stdout += c.toString();
      });
      child.stderr.on('data', (c) => {
        stderr += c.toString();
      });

      child.on('close', (code) => {
        let parsed = null;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          parsed = { finalText: stdout.trim() };
        }

        const finalText = parsed.finalText || parsed.final_text || '';
        const result = {
          workerId,
          state: code === 0 ? WORKER_STATES.COMPLETED : WORKER_STATES.FAILED,
          phase,
          finalText,
          summary: buildWorkerSummary(phase, finalText, stderr),
          claims: extractClaims(finalText),
          evidencePaths: extractEvidencePaths(finalText),
          confidence: finalText.length > 100 ? 'medium' : 'low',
          exitCode: code ?? 1,
          stderr: stderr.slice(0, 4000),
          events: parsed.events || [],
          duration_ms: Date.now() - record.startedAt,
        };

        record.state = result.state;
        record.result = result;
        resolve(result);
      });

      record.kill = () => {
        record.state = WORKER_STATES.KILLED;
        child.kill('SIGTERM');
      };
    });
  }

  getWorker(workerId) {
    return this.workers.get(workerId);
  }
}

function buildWorkerSummary(phase, finalText, stderr) {
  const head = (finalText || '').slice(0, 2000);
  return (
    '[worker:' + phase + '] ' + (head || '(no output)') + (stderr ? '\n[stderr snippet] ' + stderr.slice(0, 400) : '')
  );
}

function extractClaims(text) {
  if (!text) return [];
  return text
    .split('\n')
    .filter((l) => l.trim().length > 20)
    .slice(0, 5);
}

function extractEvidencePaths(text) {
  const paths = [];
  const re = /(?:^|\s)([\w./-]+\.(?:js|ts|md|json|html))\b/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    paths.push(m[1]);
  }
  return [...new Set(paths)].slice(0, 10);
}

module.exports = {
  WORKER_STATES,
  WorkerRuntime,
  makeWorkerId,
  buildWorkerSummary,
  DEFAULT_CHILD_TOOLS,
  resolveRunnerBin,
  packageRootDir,
};
