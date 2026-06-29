'use strict';

/**
 * background-shell.js — Background shell job registry for long-running commands.
 *
 * Jobs live on ctx for the run lifetime. Still requires --allow-shell; commands
 * pass the same shell-policy scanner as synchronous bash.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const safety = require('./safety');
const { scanShellCommand } = require('./shell-policy');

const MAX_JOBS = 8;
const MAX_CAPTURE_CHARS = 120_000;

function buildEnv(ctx) {
  const env = safety.buildSafeEnv();
  if (ctx.noNetwork) {
    env.http_proxy = '127.0.0.1:1';
    env.https_proxy = '127.0.0.1:1';
    env.HTTP_PROXY = '127.0.0.1:1';
    env.HTTPS_PROXY = '127.0.0.1:1';
    env.no_proxy = 'localhost,127.0.0.1';
    env.NO_PROXY = 'localhost,127.0.0.1';
  }
  return env;
}

function jobsMap(ctx) {
  if (!ctx._backgroundShellJobs) ctx._backgroundShellJobs = new Map();
  return ctx._backgroundShellJobs;
}

function appendCapture(text, chunk) {
  const next = text + String(chunk);
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}

function formatScanBlockReason(issues) {
  const first = issues[0];
  if (!first) return 'shell policy violation';
  if (first.kind === 'hard_deny_path') return 'blocked path pattern: ' + first.segment;
  if (first.kind === 'blocked_path_pattern') return 'blocked path pattern: ' + (first.token || first.segment);
  if (first.kind === 'blocked_env_var') return 'blocked environment variable reference';
  if (first.kind === 'network_command') return 'network command blocked (--no-network)';
  return first.kind || 'shell policy violation';
}

function startJob(ctx, command) {
  const scan = scanShellCommand(command, ctx);
  if (!scan.allowed) {
    return { ok: false, text: 'Background command blocked: ' + formatScanBlockReason(scan.issues) };
  }

  const jobs = jobsMap(ctx);
  if (jobs.size >= MAX_JOBS) {
    return { ok: false, text: 'Background shell job limit reached (' + MAX_JOBS + ').' };
  }

  const id = 'shjob_' + crypto.randomBytes(4).toString('hex');
  const cwd = ctx.cwdRealpath || ctx.cwd || process.cwd();
  const env = buildEnv(ctx);
  const job = {
    id,
    command,
    cwd,
    state: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
  };

  const child = spawn(command, [], {
    cwd,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.stdout.on('data', (chunk) => {
    job.stdout = appendCapture(job.stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    job.stderr = appendCapture(job.stderr, chunk);
  });
  child.on('close', (code, signal) => {
    job.exitCode = code;
    job.signal = signal;
    job.state = code === 0 ? 'completed' : 'failed';
    job.finishedAt = Date.now();
  });

  jobs.set(id, { child, job });
  return {
    ok: true,
    text: 'Started background shell job ' + id + '.\ncommand: ' + command + '\nPoll with manage_shell_jobs action=poll.',
    job_id: id,
  };
}

function listJobs(ctx) {
  const rows = [...jobsMap(ctx).values()].map(({ job }) => ({
    id: job.id,
    state: job.state,
    command: job.command,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
  }));
  if (!rows.length) return { ok: true, text: '(no background shell jobs in this run)' };
  return {
    ok: true,
    text: rows.map((row) => JSON.stringify(row)).join('\n'),
  };
}

function pollJob(ctx, jobId, tailChars = 4000) {
  const entry = jobsMap(ctx).get(jobId);
  if (!entry) return { ok: false, text: 'Unknown background job: ' + jobId };
  const { job } = entry;
  const tail = Math.min(Math.max(Number(tailChars) || 4000, 200), 20000);
  const stdout = job.stdout.slice(-tail);
  const stderr = job.stderr.slice(-tail);
  const lines = [
    'job_id: ' + job.id,
    'state: ' + job.state,
    'exitCode: ' + (job.exitCode ?? 'null'),
    '',
    '[stdout tail]',
    stdout || '(empty)',
  ];
  if (stderr) {
    lines.push('', '[stderr tail]', stderr);
  }
  return { ok: true, text: lines.join('\n') };
}

function killJob(ctx, jobId) {
  const entry = jobsMap(ctx).get(jobId);
  if (!entry) return { ok: false, text: 'Unknown background job: ' + jobId };
  const { child, job } = entry;
  if (job.state === 'running') {
    child.kill('SIGTERM');
    job.state = 'killed';
    job.finishedAt = Date.now();
  }
  return { ok: true, text: 'Sent SIGTERM to background job ' + jobId + ' (state=' + job.state + ').' };
}

module.exports = {
  MAX_JOBS,
  startJob,
  listJobs,
  pollJob,
  killJob,
};
