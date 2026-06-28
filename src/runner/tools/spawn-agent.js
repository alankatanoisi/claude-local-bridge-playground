'use strict';

/**
 * spawn_agent — delegate a focused subtask to a child runner with isolated context.
 *
 * Reuses WorkerRuntime (subprocess) and file/built-in agent profiles. Blocked when
 * spawnDepth > 0 so children cannot fork further.
 */

const MIN_STEPS = 1;
const MAX_STEPS = 16;
const DEFAULT_STEPS = 6;
const MAX_PROMPT_CHARS = 8000;
const MAX_SPAWNS_PER_RUN = 8;

function definition() {
  return {
    name: 'spawn_agent',
    description:
      'Delegate a focused subtask to a child agent with its own context window. ' +
      'Use built-in profiles (explore, verify, code-reviewer, …) or a file agent name/path. ' +
      'The child returns a summary; it cannot spawn further children.',
    input_schema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent id or path: built-in (explore, verify, implement, …) or .bridge-runner/agents/ name/path',
        },
        prompt: {
          type: 'string',
          description: 'Focused task for the child agent',
        },
        max_steps: {
          type: 'number',
          description: 'Child step budget (1–16, default 6)',
        },
      },
      required: ['agent', 'prompt'],
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

function formatSpawnResult(agentName, result) {
  const lines = [
    '[spawn_agent:' + agentName + '] state=' + result.state,
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

  const agentName = String(args.agent || '').trim();
  const prompt = String(args.prompt || '').trim();
  if (!agentName) return { ok: false, text: 'spawn_agent requires agent.' };
  if (!prompt) return { ok: false, text: 'spawn_agent requires prompt.' };
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, text: 'spawn_agent prompt exceeds ' + MAX_PROMPT_CHARS + ' characters.' };
  }

  ctx.spawnCount = (ctx.spawnCount || 0) + 1;
  if (ctx.spawnCount > MAX_SPAWNS_PER_RUN) {
    return { ok: false, text: 'spawn_agent limit reached for this run (' + MAX_SPAWNS_PER_RUN + ').' };
  }

  const cwd = ctx.cwdRealpath || ctx.cwd;
  const { getProfile } = require('../agents/registry');
  const profile = getProfile(agentName, { cwd, allowShell: !!ctx.allowShell });
  if (!profile) {
    return {
      ok: false,
      text: 'Unknown agent: ' + agentName + '. Use --list-agents or place a file under .bridge-runner/agents/.',
    };
  }

  const runtime = ensureWorkerRuntime(ctx);
  const maxSteps = clampSteps(args.max_steps ?? profile.maxSteps ?? DEFAULT_STEPS);

  const result = await runtime.spawnWorker(
    {
      agent: agentName,
      prompt,
      cwd,
      maxSteps,
      phase: 'subagent',
      allowShell: !!ctx.allowShell,
      acceptEdits: !!ctx.acceptEdits,
      dontAsk: !!ctx.dontAsk,
    },
    { allowShell: !!ctx.allowShell },
  );

  const ok = result.state === 'completed';
  return {
    ok,
    text: formatSpawnResult(profile.id || agentName, result),
    bytes: (result.finalText || '').length,
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'spawn_agent', category: 'orchestration' },
};
