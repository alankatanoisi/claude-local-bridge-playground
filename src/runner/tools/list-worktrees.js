'use strict';

/**
 * list_worktrees — show active run slots and on-disk orphan worktree directories.
 */

const { listRegisteredWorktrees, scanOrphanWorktreeDirs, worktreeRoot } = require('../worktree-utils');

function definition() {
  return {
    name: 'list_worktrees',
    description: 'List worktree slots registered in this run and orphan directories under ~/.bridge-runner/worktrees/.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };
}

function execute(_args, ctx) {
  const registered = listRegisteredWorktrees(ctx);
  const orphanDirs = scanOrphanWorktreeDirs();
  const registeredPaths = new Set(registered.map((row) => row.path));
  const orphans = orphanDirs.filter((dir) => !registeredPaths.has(dir));

  const lines = ['Worktree slots in this run (' + registered.length + '):'];
  if (!registered.length) {
    lines.push('  (none)');
  } else {
    for (const row of registered) {
      lines.push(
        '  - slot=' + row.slot + (row.active ? ' [active]' : '') + ' branch=' + row.branch + ' path=' + row.path,
      );
    }
  }

  lines.push('');
  lines.push('Orphan directories under ' + worktreeRoot() + ' (' + orphans.length + '):');
  if (!orphans.length) {
    lines.push('  (none)');
  } else {
    for (const dir of orphans) {
      lines.push('  - ' + dir);
    }
    lines.push('');
    lines.push('Prune orphans manually: git worktree remove <path> && git branch -D <branch>');
  }

  return { ok: true, text: lines.join('\n') };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'list_worktrees', category: 'read-only' },
};
