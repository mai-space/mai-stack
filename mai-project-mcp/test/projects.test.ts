import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../src/db/schema.js';
import { createTestDb, migrateTestDb, insertProject, insertTask } from './testDb.js';
import { projectRoutes } from '../src/routes/projects.js';

describe('mai-project-mcp project routes', () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
      return reply.status(500).send({ error: 'Internal server error' });
    });
    await projectRoutes(app, db, null);
  });

  it('creates a project with a generated id when none is given', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { name: 'App A' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeTruthy();
  });

  it('rejects creating a project with a duplicate id', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A' } });
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A again' } });
    expect(res.statusCode).toBe(409);
  });

  it('lists tasks for a project ordered by priority descending', async () => {
    await insertProject(db, 'a');
    await insertTask(db, { project_id: 'a', title: 'low', priority: 1 });
    await insertTask(db, { project_id: 'a', title: 'high', priority: 9 });
    const res = await app.inject({ method: 'GET', url: '/projects/a/tasks' });
    expect(res.statusCode).toBe(200);
    const titles = res.json().map((t: { title: string }) => t.title);
    expect(titles).toEqual(['high', 'low']);
  });

  it('GET tasks 404s for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/missing/tasks' });
    expect(res.statusCode).toBe(404);
  });

  it('creates a task under a project via POST /projects/:id/tasks', async () => {
    await insertProject(db, 'a');
    const res = await app.inject({ method: 'POST', url: '/projects/a/tasks', payload: { title: 'New task', priority: 3 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('OPEN');
  });

  describe('bulk-close-blocked', () => {
    it('closes every non-SUBTASK blocked task by default', async () => {
      await insertProject(db, 'a');
      const decision = await insertTask(db, { project_id: 'a', status: 'BLOCKED', blocker_type: 'DECISION' });
      const risk = await insertTask(db, { project_id: 'a', status: 'BLOCKED', blocker_type: 'RISK' });
      const subtaskBlocked = await insertTask(db, { project_id: 'a', status: 'BLOCKED', blocker_type: 'SUBTASK' });
      const open = await insertTask(db, { project_id: 'a', status: 'OPEN' });

      const res = await app.inject({ method: 'POST', url: '/projects/a/bulk-close-blocked' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.closed).toBe(2);
      expect(new Set(body.task_ids)).toEqual(new Set([decision, risk]));

      const subtask = await db.selectFrom('tasks').selectAll().where('id', '=', subtaskBlocked).executeTakeFirstOrThrow();
      expect(subtask.status).toBe('BLOCKED'); // SUBTASK is never bulk-closed

      const untouchedOpen = await db.selectFrom('tasks').selectAll().where('id', '=', open).executeTakeFirstOrThrow();
      expect(untouchedOpen.status).toBe('OPEN');
    });

    it('respects an explicit blocker_types filter', async () => {
      await insertProject(db, 'a');
      const decision = await insertTask(db, { project_id: 'a', status: 'BLOCKED', blocker_type: 'DECISION' });
      const risk = await insertTask(db, { project_id: 'a', status: 'BLOCKED', blocker_type: 'RISK' });

      const res = await app.inject({ method: 'POST', url: '/projects/a/bulk-close-blocked', payload: { blocker_types: ['DECISION'] } });
      expect(res.json().closed).toBe(1);
      expect(res.json().task_ids).toEqual([decision]);

      const riskTask = await db.selectFrom('tasks').selectAll().where('id', '=', risk).executeTakeFirstOrThrow();
      expect(riskTask.status).toBe('BLOCKED');
    });

    it('returns closed: 0 when nothing matches', async () => {
      await insertProject(db, 'a');
      const res = await app.inject({ method: 'POST', url: '/projects/a/bulk-close-blocked' });
      expect(res.json()).toEqual({ closed: 0, task_ids: [] });
    });

    it('404s for an unknown project', async () => {
      const res = await app.inject({ method: 'POST', url: '/projects/missing/bulk-close-blocked' });
      expect(res.statusCode).toBe(404);
    });
  });
});
