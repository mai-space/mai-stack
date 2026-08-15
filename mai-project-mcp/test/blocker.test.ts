import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { Database } from '../src/db/schema.js';
import { createTestDb, migrateTestDb, insertProject, insertTask } from './testDb.js';
import { onTaskDone } from '../src/services/blocker.js';

describe('onTaskDone — SUBTASK auto-resume DAG logic', () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await insertProject(db);
  });

  it('is a no-op when the completed task has no parent', async () => {
    const taskId = await insertTask(db, { status: 'DONE' });
    await onTaskDone(db, null, taskId);
    // nothing to assert on the task itself — this just must not throw
    expect(true).toBe(true);
  });

  it('does not resume a parent that is not BLOCKED:SUBTASK', async () => {
    const parentId = await insertTask(db, { status: 'IN_PROGRESS' });
    const childId = await insertTask(db, { status: 'DONE', parent_task_id: parentId });
    await onTaskDone(db, null, childId);
    const parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
    expect(parent.status).toBe('IN_PROGRESS');
  });

  it('resumes a single-child parent once the child completes', async () => {
    const parentId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'SUBTASK' });
    const childId = await insertTask(db, { status: 'DONE', parent_task_id: parentId });

    await onTaskDone(db, null, childId);

    const parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
    expect(parent.status).toBe('OPEN');
    expect(parent.blocker_type).toBeNull();
    expect(parent.blocker_payload).toBe('{}');
    expect(parent.blocker_resolved_at).not.toBeNull();
  });

  it('keeps the parent BLOCKED while any sibling subtask is still not DONE', async () => {
    const parentId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'SUBTASK' });
    const child1 = await insertTask(db, { status: 'DONE', parent_task_id: parentId });
    await insertTask(db, { status: 'OPEN', parent_task_id: parentId }); // still pending

    await onTaskDone(db, null, child1);

    const parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
    expect(parent.status).toBe('BLOCKED');
    expect(parent.blocker_type).toBe('SUBTASK');
  });

  it('resumes the parent only once the last of several subtasks completes', async () => {
    const parentId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'SUBTASK' });
    const child1 = await insertTask(db, { status: 'OPEN', parent_task_id: parentId });
    const child2 = await insertTask(db, { status: 'OPEN', parent_task_id: parentId });

    // finish child1 first via a direct status update (simulating an earlier /complete call) then onTaskDone(child1)
    await db.updateTable('tasks').set({ status: 'DONE' }).where('id', '=', child1).execute();
    await onTaskDone(db, null, child1);
    let parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
    expect(parent.status).toBe('BLOCKED');

    await db.updateTable('tasks').set({ status: 'DONE' }).where('id', '=', child2).execute();
    await onTaskDone(db, null, child2);
    parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
    expect(parent.status).toBe('OPEN');
  });
});
