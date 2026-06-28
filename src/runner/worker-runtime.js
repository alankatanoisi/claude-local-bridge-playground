'use strict';

const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const { getProfile, applyProfileToRunOptions } = require('./agents/registry');

const WORKER_STATES = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  KILLED: 'killed',
});

function makeWorkerId(prefix = 'wrk') {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

class WorkerRuntime {
  constructor(options = {}) {
    this.runnerBin = options.runnerBin || path.join(process.cwd(), 'bin/local-bridge-runner.js');
    this.workers = new Map();
    this.spawnDepth = options.spawnDepth || 0;
  }

  spawnWorker(spec, options = {}) {
    const workerId = makeWorkerId();
    const phase = spec.phase || 'research';
    const profile = spec.agent
      ? getProfile(spec.agent, { cwd: spec.cwd, allowShell: !!(spec.allowShell || options.allowShell) })
      : null;
    const allowedList = spec.allowedTools ||
      profile?.allowedTools || [
        'list_files',
        'read_file',
        'search_text',
        'glob',
        'git_status',
        'manage_tasks',
        'spawn_agent',
      ];
    const allowed = allowedList.join(',');

    const args = [
      this.runnerBin,
      '--cwd',
      spec.cwd,
      '--output-format',
      'json',
      '--max-steps',
      String(spec.maxSteps || profile?.maxSteps || 6),
      '--allowed-tools',
      allowed,
      '--log-level',
      'quiet',
      '--trust-workspace',
    ];

    if (profile?.allowShell || allowedList.includes('bash')) args.push('--allow-shell');
    if (spec.acceptEdits || options.acceptEdits) args.push('--accept-edits');
    if (spec.dontAsk || options.dontAsk) args.push('--dont-ask');
    if (spec.agent) args.push('--agent', spec.agent);

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
      const child = spawn(process.execPath, args, {
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
  applyProfileToRunOptions,
};
