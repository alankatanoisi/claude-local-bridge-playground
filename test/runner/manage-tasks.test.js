'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execute } = require('../../src/runner/tools/manage-tasks');

describe('manage_tasks tool', () => {
  const ctx = { tasks: [] };

  it('replaces the checklist when merge is false', () => {
    ctx.tasks = [{ id: 'old', content: 'Old task', status: 'pending' }];
    const result = execute(
      {
        merge: false,
        tasks: [{ id: 'a', content: 'First', status: 'pending' }],
      },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(ctx.tasks.length, 1);
    assert.equal(ctx.tasks[0].id, 'a');
    assert.match(result.text, /First/);
  });

  it('upserts by id when merge is true', () => {
    ctx.tasks = [{ id: 'a', content: 'First', status: 'pending' }];
    const result = execute(
      {
        merge: true,
        tasks: [
          { id: 'a', content: 'First updated', status: 'in_progress' },
          { id: 'b', content: 'Second', status: 'pending' },
        ],
      },
      ctx,
    );
    assert.equal(result.ok, true);
    assert.equal(ctx.tasks.length, 2);
    assert.equal(ctx.tasks[0].status, 'in_progress');
    assert.match(result.text, /Second/);
  });

  it('rejects invalid status values', () => {
    const result = execute(
      {
        merge: false,
        tasks: [{ id: 'x', content: 'Bad status', status: 'done' }],
      },
      ctx,
    );
    assert.equal(result.ok, false);
    assert.match(result.text, /invalid status/i);
  });
});
