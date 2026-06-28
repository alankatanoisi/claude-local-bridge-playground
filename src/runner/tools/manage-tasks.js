'use strict';

/**
 * manage_tasks tool — in-session task checklist (TodoWrite / Task* analog).
 *
 * Stores tasks on ctx.tasks and persists them through the session store.
 * No filesystem side effects; read-only permission category.
 */

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const MAX_TASKS = 50;
const MAX_CONTENT_CHARS = 500;

function definition() {
  return {
    name: 'manage_tasks',
    description:
      'Create or update the in-session task checklist. Use merge=true to upsert tasks by id, ' +
      'or merge=false to replace the whole list. Status values: pending, in_progress, completed, cancelled.',
    input_schema: {
      type: 'object',
      properties: {
        merge: {
          type: 'boolean',
          description: 'If true, upsert tasks by id. If false, replace the entire checklist.',
        },
        tasks: {
          type: 'array',
          description: 'Task entries to write',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable task id' },
              content: { type: 'string', description: 'Short task description' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
              },
            },
            required: ['id', 'content', 'status'],
          },
        },
      },
      required: ['tasks'],
    },
  };
}

function ensureTaskList(ctx) {
  if (!ctx.tasks || !Array.isArray(ctx.tasks)) ctx.tasks = [];
  return ctx.tasks;
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Each task must be an object.' };
  const id = String(raw.id || '').trim();
  const content = String(raw.content || '').trim();
  const status = String(raw.status || '').trim();
  if (!id) return { error: 'Each task needs a non-empty id.' };
  if (!content) return { error: 'Task "' + id + '" needs content.' };
  if (content.length > MAX_CONTENT_CHARS) {
    return { error: 'Task "' + id + '" content exceeds ' + MAX_CONTENT_CHARS + ' characters.' };
  }
  if (!VALID_STATUSES.has(status)) {
    return { error: 'Task "' + id + '" has invalid status: ' + status };
  }
  return { task: { id, content, status } };
}

function formatTaskList(tasks) {
  if (!tasks.length) return 'Task checklist is empty.';
  const lines = ['Task checklist (' + tasks.length + '):'];
  for (const task of tasks) {
    const mark =
      task.status === 'completed'
        ? '[x]'
        : task.status === 'cancelled'
          ? '[-]'
          : task.status === 'in_progress'
            ? '[>]'
            : '[ ]';
    lines.push(mark + ' ' + task.id + ': ' + task.content + ' (' + task.status + ')');
  }
  return lines.join('\n');
}

function execute(args, ctx) {
  const incoming = args && Array.isArray(args.tasks) ? args.tasks : null;
  if (!incoming) {
    return { ok: false, text: 'Missing tasks array.' };
  }
  if (incoming.length > MAX_TASKS) {
    return { ok: false, text: 'Too many tasks in one call (max ' + MAX_TASKS + ').' };
  }

  const normalized = [];
  for (const raw of incoming) {
    const parsed = normalizeTask(raw);
    if (parsed.error) return { ok: false, text: parsed.error };
    normalized.push(parsed.task);
  }

  const merge = !!(args && args.merge);
  const tasks = ensureTaskList(ctx);

  if (merge) {
    for (const task of normalized) {
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = task;
      else tasks.push(task);
    }
  } else {
    ctx.tasks = normalized.slice();
  }

  if (ctx.tasks.length > MAX_TASKS) {
    ctx.tasks = ctx.tasks.slice(0, MAX_TASKS);
  }

  return { ok: true, text: formatTaskList(ctx.tasks) };
}

module.exports = { definition, execute, meta: { name: 'manage_tasks', category: 'read-only' } };
