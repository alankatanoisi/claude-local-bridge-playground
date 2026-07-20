'use strict';

/**
 * spawn_agent — delegate a focused subtask to a child runner with isolated context.
 *
 * Reuses WorkerRuntime (subprocess) with a small read-only child capability
 * set. Blocked when spawnDepth > 0 so children cannot fork further.
 */

const MIN_STEPS = 1;
const MAX_STEPS = 16;
const DEFAULT_STEPS = 6;
const MAX_PROMPT_CHARS = 8000;
const MAX_SPAWNS_PER_RUN = 8;

const CHILD_READ_TOOLS = Object.freeze([
  'list_files',
  'read_file',
  'search_text',
  'glob',
  'git_status',
  'manage_tasks',
  'ask_user_question',
]);

function definition() {
  return {
    name: 'spawn_agent',
    description:
      'Delegate a focused read-only subtask to a generic child agent with its own context window. ' +
      'The child returns a summary and cannot spawn further children.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Focused task for the child agent',
        },
        max_steps: {
          type: 'number',
          description: 'Child step budget (1–16, default 6)',
        },
      },
      required: ['prompt'],
    },
  };
}

function resolveSpawnDepth(ctx) {
  return ctx.spawnDepth || 0;
}

function clampSteps(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_STEPS;
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.floor(n)));
}

function ensureWorkerRuntime(ctx) {
  if (ctx.workerRuntime) return ctx.workerRuntime;
  const { WorkerRuntime } = require('../worker-runtime');
  ctx.workerRuntime = new WorkerRuntime({ spawnDepth: resolveSpawnDepth(ctx) });
  return ctx.workerRuntime;
}

function formatSpawnResult(result) {
  const lines = [
    '[spawn_agent] state=' + result.state,
    'duration_ms=' + result.duration_ms,
    'exitCode=' + result.exitCode,
    '',
    result.finalText || result.summary || '(no output)',
  ];
  if (result.stderr && result.stderr.trim()) {
    lines.push('', '[stderr]', result.stderr.trim().slice(0, 1200));
  }
  return lines.join('\n');
}

async function execute(args, ctx) {
  if (resolveSpawnDepth(ctx) > 0) {
    return { ok: false, text: 'Child agents cannot spawn further children (fork depth exceeded).' };
  }

  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { ok: false, text: 'spawn_agent requires prompt.' };
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, text: 'spawn_agent prompt exceeds ' + MAX_PROMPT_CHARS + ' characters.' };
  }

  ctx.spawnCount = (ctx.spawnCount || 0) + 1;
  if (ctx.spawnCount > MAX_SPAWNS_PER_RUN) {
    return { ok: false, text: 'spawn_agent limit reached for this run (' + MAX_SPAWNS_PER_RUN + ').' };
  }

  const cwd = ctx.cwdRealpath || ctx.cwd;
  const runtime = ensureWorkerRuntime(ctx);
  const maxSteps = clampSteps(args.max_steps ?? DEFAULT_STEPS);

  const budgetRemaining =
    typeof ctx.budgetInputRemaining === 'number' || typeof ctx.budgetOutputRemaining === 'number'
      ? {
          input_tokens: ctx.budgetInputRemaining,
          output_tokens: ctx.budgetOutputRemaining,
        }
      : null;

  const result = await runtime.spawnWorker(
    {
      prompt,
      cwd,
      maxSteps,
      phase: 'subagent',
      allowedTools: [...CHILD_READ_TOOLS],
      budgetRemaining,
    },
    {
      // Generic read-only children do not inherit shell/edit automation flags.
      allowShell: false,
      acceptEdits: false,
      dontAsk: false,
      // WP2: the child's tools are additionally clamped to the parent ceiling.
      parentCeiling: ctx.authorityCeiling || null,
    },
  );

  const ok = result.state === 'completed';
  return {
    ok,
    text: formatSpawnResult(result),
    bytes: (result.finalText || '').length,
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'spawn_agent', category: 'orchestration' },
};
