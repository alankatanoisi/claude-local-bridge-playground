'use strict';

/**
 * spawn_agent — delegate a focused subtask to a child runner with isolated context.
 *
 * Reuses WorkerRuntime (subprocess) with a small read-only child capability
 * set. Blocked when spawnDepth > 0 so children cannot fork further.
 *
 * P1-05: child token budgets are leased from the parent broker, not copied.
 * Actual child usage is reconciled into the parent totalUsage on return.
 */

const MIN_STEPS = 1;
const MAX_STEPS = 16;
const DEFAULT_STEPS = 6;
const MAX_PROMPT_CHARS = 8000;
const MAX_SPAWNS_PER_RUN = 8;

const { buildChildInheritSpec, buildChildManifest } = require('../child-inherit');

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

function formatSpawnResult(result, leaseNote) {
  const lines = [
    '[spawn_agent] state=' + result.state,
    'duration_ms=' + result.duration_ms,
    'exitCode=' + result.exitCode,
  ];
  if (leaseNote) lines.push(leaseNote);
  if (result.usage) {
    lines.push(
      'child_usage input=' + (result.usage.input_tokens || 0) + ' output=' + (result.usage.output_tokens || 0),
    );
  }
  lines.push('', result.finalText || result.summary || '(no output)');
  if (result.stderr && result.stderr.trim()) {
    lines.push('', '[stderr]', result.stderr.trim().slice(0, 1200));
  }
  return lines.join('\n');
}

function releaseLease(ctx, lease, actualUsage) {
  if (!lease) return;
  if (typeof ctx.reconcileChildUsage === 'function') {
    ctx.reconcileChildUsage(lease.leaseId, actualUsage);
  } else if (ctx.budgetBroker && lease.leaseId) {
    ctx.budgetBroker.release(lease.leaseId, actualUsage);
  }
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

  // P1-05: lease from the parent broker before spawning. Without a broker
  // (unit tests that inject no caps), fall back to copy-of-remainder.
  let lease = null;
  let leaseNote = null;
  if (ctx.budgetBroker) {
    const parentUsage =
      typeof ctx.getParentUsage === 'function' ? ctx.getParentUsage() : { input_tokens: 0, output_tokens: 0 };
    lease = ctx.budgetBroker.acquire(parentUsage);
    if (!lease) {
      return {
        ok: false,
        text: 'spawn_agent refused: parent token budget has no unleased remainder for a child.',
      };
    }
    if (!lease.unconstrained) {
      leaseNote =
        'budget_lease id=' + lease.leaseId + ' input=' + lease.input_tokens + ' output=' + lease.output_tokens;
    }
  }

  const cwd = ctx.cwdRealpath || ctx.cwd;
  const runtime = ensureWorkerRuntime(ctx);
  const maxSteps = clampSteps(args.max_steps ?? DEFAULT_STEPS);

  const budgetRemaining = lease
    ? lease.unconstrained
      ? null
      : { input_tokens: lease.input_tokens, output_tokens: lease.output_tokens }
    : typeof ctx.budgetInputRemaining === 'number' || typeof ctx.budgetOutputRemaining === 'number'
      ? {
          input_tokens: ctx.budgetInputRemaining,
          output_tokens: ctx.budgetOutputRemaining,
        }
      : null;

  // P1-10: compute remaining wall-clock at spawn time so the child cannot
  // outlive the parent's --max-wall-clock-ms ceiling.
  let remainingWall = null;
  if (typeof ctx.childInherit?.maxWallClockMs === 'number' && ctx.childInherit.maxWallClockMs > 0) {
    const started = ctx.runStartedAtMs || Date.now();
    remainingWall = Math.max(1, ctx.childInherit.maxWallClockMs - (Date.now() - started));
  }
  const inherit = buildChildInheritSpec(ctx, { maxWallClockMs: remainingWall });

  let result;
  try {
    result = await runtime.spawnWorker(
      {
        prompt,
        cwd,
        maxSteps,
        phase: 'subagent',
        allowedTools: [...CHILD_READ_TOOLS],
        budgetRemaining,
        leaseId: lease && lease.leaseId,
        inherit,
      },
      {
        // Generic read-only children do not inherit shell/edit automation flags.
        allowShell: false,
        acceptEdits: false,
        dontAsk: false,
        // WP2: the child's tools are additionally clamped to the parent ceiling.
        parentCeiling: ctx.authorityCeiling || null,
        // P1-10: caller token via env only.
        callerToken: ctx.childInherit && ctx.childInherit.callerToken ? ctx.childInherit.callerToken : null,
      },
    );
  } catch (err) {
    releaseLease(ctx, lease, null);
    return { ok: false, text: 'spawn_agent failed to start child: ' + err.message };
  }

  releaseLease(ctx, lease, result.usage || null);

  // P1-10: attach a complete child manifest to the parent run for accounting.
  const manifest = buildChildManifest({
    workerResult: result,
    inherit,
    leaseId: lease && lease.leaseId,
    phase: 'subagent',
  });
  if (!ctx.childManifests) ctx.childManifests = [];
  ctx.childManifests.push(manifest);
  if (typeof ctx.recordChildManifest === 'function') {
    ctx.recordChildManifest(manifest);
  }

  const ok = result.state === 'completed';
  return {
    ok,
    text: formatSpawnResult(result, leaseNote),
    bytes: (result.finalText || '').length,
    usage: result.usage || null,
    leaseId: lease && lease.leaseId,
    childManifest: manifest,
  };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'spawn_agent', category: 'orchestration' },
};
