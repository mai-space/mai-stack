import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../src/db/schema.js';
import { createTestDb, migrateTestDb, insertProject, insertTask } from './testDb.js';
import { taskRoutes } from '../src/routes/tasks.js';

describe('mai-project-mcp task routes', () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    await insertProject(db);
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
      return reply.status(500).send({ error: 'Internal server error' });
    });
    // redis is null in tests — publishStateChange() is a documented no-op when redis is falsy
    await taskRoutes(app, db, null);
  });

  it('GET /tasks/:id 404s for an unknown task', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks/missing' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /tasks/:id updates only the given fields', async () => {
    const id = await insertTask(db, { title: 'Original' });
    const res = await app.inject({ method: 'PUT', url: `/tasks/${id}`, payload: { priority: 5 } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.priority).toBe(5);
    expect(body.title).toBe('Original');
  });

  describe('claim', () => {
    it('claims an OPEN task, setting IN_PROGRESS and a lease', async () => {
      const id = await insertTask(db, { status: 'OPEN' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/claim`, payload: { agent_id: 'agent-1' } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('IN_PROGRESS');
      expect(body.assigned_agent).toBe('agent-1');
      expect(body.lease_expires_at).not.toBeNull();
    });

    it('rejects claiming a non-OPEN task with 409', async () => {
      const id = await insertTask(db, { status: 'IN_PROGRESS' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/claim`, payload: { agent_id: 'agent-1' } });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('complete', () => {
    it('marks a task DONE', async () => {
      const id = await insertTask(db, { status: 'IN_PROGRESS' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/complete` });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('DONE');
    });

    it('rejects completing an already-DONE task with 409', async () => {
      const id = await insertTask(db, { status: 'DONE' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/complete` });
      expect(res.statusCode).toBe(409);
    });

    it('auto-resumes a BLOCKED:SUBTASK parent when its only child completes', async () => {
      const parentId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'SUBTASK' });
      const childId = await insertTask(db, { status: 'IN_PROGRESS', parent_task_id: parentId });

      const res = await app.inject({ method: 'POST', url: `/tasks/${childId}/complete` });
      expect(res.statusCode).toBe(200);

      const parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
      expect(parent.status).toBe('OPEN');
      expect(parent.blocker_type).toBeNull();
    });
  });

  it('resolve-blocker moves a BLOCKED task back to OPEN with a resolution note', async () => {
    const id = await insertTask(db, { status: 'BLOCKED', blocker_type: 'DECISION', blocker_payload: JSON.stringify({ question: 'A or B?' }) });
    const res = await app.inject({ method: 'POST', url: `/tasks/${id}/resolve-blocker`, payload: { resolution: 'A' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('OPEN');
    expect(body.blocker_type).toBeNull();
    expect(JSON.parse(body.blocker_payload).resolution).toBe('A');
  });

  describe('renew-lease', () => {
    it('renews the lease for the assigned agent', async () => {
      const id = await insertTask(db, { status: 'IN_PROGRESS', assigned_agent: 'agent-1' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/renew-lease`, payload: { agent_id: 'agent-1' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().renewed).toBe(true);
    });

    it('rejects renewal from an agent that does not own the task', async () => {
      const id = await insertTask(db, { status: 'IN_PROGRESS', assigned_agent: 'agent-1' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/renew-lease`, payload: { agent_id: 'agent-2' } });
      expect(res.statusCode).toBe(403);
    });
  });

  it('subtask creates a child task and blocks the parent as SUBTASK', async () => {
    const parentId = await insertTask(db, { status: 'IN_PROGRESS' });
    const res = await app.inject({ method: 'POST', url: `/tasks/${parentId}/subtask`, payload: { title: 'Child', description: 'do this first' } });
    expect(res.statusCode).toBe(201);
    const { subtask_id } = res.json();

    const child = await db.selectFrom('tasks').selectAll().where('id', '=', subtask_id).executeTakeFirstOrThrow();
    expect(child.parent_task_id).toBe(parentId);
    expect(child.status).toBe('OPEN');

    const parent = await db.selectFrom('tasks').selectAll().where('id', '=', parentId).executeTakeFirstOrThrow();
    expect(parent.status).toBe('BLOCKED');
    expect(parent.blocker_type).toBe('SUBTASK');
  });

  describe('block + resolve: DECISION', () => {
    it('blocks with a question/options and resolves with a choice', async () => {
      const id = await insertTask(db);
      const block = await app.inject({ method: 'POST', url: `/tasks/${id}/block/decision`, payload: { question: 'Which DB?', options: ['A', 'B'] } });
      expect(block.json().blocker_type).toBe('DECISION');

      const resolve = await app.inject({ method: 'POST', url: `/tasks/${id}/resolve/decision`, payload: { choice: 'A' } });
      expect(resolve.statusCode).toBe(200);
      const body = resolve.json();
      expect(body.status).toBe('OPEN');
      expect(JSON.parse(body.blocker_payload).choice).toBe('A');
    });

    it('rejects resolving a DECISION when the task is blocked by a different type', async () => {
      const id = await insertTask(db, { status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"low"}' });
      const res = await app.inject({ method: 'POST', url: `/tasks/${id}/resolve/decision`, payload: { choice: 'A' } });
      expect(res.statusCode).toBe(409);
    });
  });

  it('block/clarification then resolve appends the response to the description', async () => {
    const id = await insertTask(db);
    await app.inject({ method: 'POST', url: `/tasks/${id}/block/clarification`, payload: { question: 'Which env?' } });
    const res = await app.inject({ method: 'POST', url: `/tasks/${id}/resolve/clarification`, payload: { response: 'staging' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().description).toContain('staging');
  });

  describe('RISK blocker', () => {
    it('a critical risk also blocks every other IN_PROGRESS task in the same project', async () => {
      const riskyId = await insertTask(db, { status: 'IN_PROGRESS' });
      const otherId = await insertTask(db, { status: 'IN_PROGRESS' });
      const doneId = await insertTask(db, { status: 'DONE' }); // must not be touched

      await app.inject({ method: 'POST', url: `/tasks/${riskyId}/block/risk`, payload: { description: 'dangerous migration', severity: 'critical' } });

      const other = await db.selectFrom('tasks').selectAll().where('id', '=', otherId).executeTakeFirstOrThrow();
      expect(other.status).toBe('BLOCKED');
      expect(other.blocker_type).toBe('RISK');

      const done = await db.selectFrom('tasks').selectAll().where('id', '=', doneId).executeTakeFirstOrThrow();
      expect(done.status).toBe('DONE');
    });

    it('a non-critical risk does not cascade to other tasks', async () => {
      const riskyId = await insertTask(db, { status: 'IN_PROGRESS' });
      const otherId = await insertTask(db, { status: 'IN_PROGRESS' });

      await app.inject({ method: 'POST', url: `/tasks/${riskyId}/block/risk`, payload: { description: 'minor concern', severity: 'low' } });

      const other = await db.selectFrom('tasks').selectAll().where('id', '=', otherId).executeTakeFirstOrThrow();
      expect(other.status).toBe('IN_PROGRESS');
    });

    it('resolve/risk approved reopens the task; rejected marks it DONE', async () => {
      const approvedId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"low"}' });
      const approveRes = await app.inject({ method: 'POST', url: `/tasks/${approvedId}/resolve/risk`, payload: { approved: true } });
      expect(approveRes.json().status).toBe('OPEN');

      const rejectedId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"low"}' });
      const rejectRes = await app.inject({ method: 'POST', url: `/tasks/${rejectedId}/resolve/risk`, payload: { approved: false } });
      expect(rejectRes.json().status).toBe('DONE');
    });

    it('approving a critical risk releases every other RISK-blocked task in the project', async () => {
      const criticalId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"critical"}' });
      const cascadedId = await insertTask(db, { status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"critical"}' });

      await app.inject({ method: 'POST', url: `/tasks/${criticalId}/resolve/risk`, payload: { approved: true } });

      const cascaded = await db.selectFrom('tasks').selectAll().where('id', '=', cascadedId).executeTakeFirstOrThrow();
      expect(cascaded.status).toBe('OPEN');
      expect(cascaded.blocker_type).toBeNull();
    });
  });

  it('reassign sets CAPABILITY blocker and re-queues the task as OPEN (not BLOCKED)', async () => {
    const id = await insertTask(db, { status: 'IN_PROGRESS', assigned_agent: 'agent-1' });
    const res = await app.inject({ method: 'POST', url: `/tasks/${id}/reassign`, payload: { required_capability: 'php', reason: 'needs PHP expertise' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('OPEN');
    expect(body.blocker_type).toBe('CAPABILITY');
    expect(body.assigned_agent).toBeNull();
  });
});
