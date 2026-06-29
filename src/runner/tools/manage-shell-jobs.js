'use strict';

/**
 * manage_shell_jobs — start, list, poll, and kill background shell commands.
 *
 * Gated behind --allow-shell (shell category). Uses the same shell-policy
 * scanner as synchronous bash.
 */

const { startJob, listJobs, pollJob, killJob } = require('../background-shell');

function definition() {
  return {
    name: 'manage_shell_jobs',
    description:
      'Manage background shell jobs for long-running commands (dev servers, watch tasks). ' +
      'Actions: start (requires command), list, poll (requires job_id), kill (requires job_id).',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'list', 'poll', 'kill'],
          description: 'Job operation to perform',
        },
        command: {
          type: 'string',
          description: 'Shell command for action=start',
        },
        job_id: {
          type: 'string',
          description: 'Background job id for poll/kill',
        },
        tail_chars: {
          type: 'number',
          description: 'Characters of output tail for poll (default 4000)',
        },
      },
      required: ['action'],
    },
  };
}

async function execute(args, ctx) {
  const action = String(args.action || '').trim();
  if (!action) return { ok: false, text: 'manage_shell_jobs requires action.' };

  if (action === 'start') {
    const command = String(args.command || '').trim();
    if (!command) return { ok: false, text: 'action=start requires command.' };
    return startJob(ctx, command);
  }
  if (action === 'list') return listJobs(ctx);
  if (action === 'poll') {
    const jobId = String(args.job_id || '').trim();
    if (!jobId) return { ok: false, text: 'action=poll requires job_id.' };
    return pollJob(ctx, jobId, args.tail_chars);
  }
  if (action === 'kill') {
    const jobId = String(args.job_id || '').trim();
    if (!jobId) return { ok: false, text: 'action=kill requires job_id.' };
    return killJob(ctx, jobId);
  }
  return { ok: false, text: 'Unknown action: ' + action };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'manage_shell_jobs', category: 'shell' },
};
