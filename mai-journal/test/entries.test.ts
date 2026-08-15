import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../src/db/schema.js';
import { createTestDb, migrateTestDb, createFakeRedis } from './testDb.js';
import { entryRoutes } from '../src/routes/entries.js';

describe('mai-journal entry routes', () => {
  let app: FastifyInstance;
  let db: Kysely<Database>;
  let redis: ReturnType<typeof createFakeRedis>;

  beforeEach(async () => {
    db = createTestDb();
    await migrateTestDb(db);
    redis = createFakeRedis();
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
      return reply.status(500).send({ error: 'Internal server error' });
    });
    await entryRoutes(app, db, redis as any);
  });

  it('appends an entry, returns 201, and publishes it live', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/journal/task-1/entries',
      payload: { project_id: 'app-a', agent_id: 'agent-1', kind: 'agent_started', payload: { worktree: '/tmp/x' } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.task_id).toBe('task-1');
    expect(body.kind).toBe('agent_started');
    expect(body.payload).toEqual({ worktree: '/tmp/x' });

    expect(redis.published).toHaveLength(1);
    expect(redis.published[0].channel).toBe('journal.task-1');
    expect(JSON.parse(redis.published[0].message).id).toBe(body.id);
  });

  it('rejects an invalid kind with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { kind: 'not_a_real_kind' } });
    expect(res.statusCode).toBe(400);
  });

  it('defaults payload to {} when omitted', async () => {
    const res = await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { kind: 'note' } });
    expect(res.json().payload).toEqual({});
  });

  it('lists entries for a task in chronological order', async () => {
    await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { kind: 'agent_started' } });
    await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { kind: 'agent_finished' } });
    await app.inject({ method: 'POST', url: '/journal/task-2/entries', payload: { kind: 'note' } }); // different task

    const res = await app.inject({ method: 'GET', url: '/journal/task-1/entries' });
    expect(res.statusCode).toBe(200);
    const kinds = res.json().map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(['agent_started', 'agent_finished']);
  });

  it('the since filter only returns entries created after the given id', async () => {
    const first = (await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { kind: 'agent_started' } })).json();
    await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { kind: 'gate_result' } });

    const res = await app.inject({ method: 'GET', url: `/journal/task-1/entries?since=${first.id}` });
    const kinds = res.json().map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(['gate_result']);
  });

  it('lists recent entries for a project, most-recent-first, up to the limit', async () => {
    await app.inject({ method: 'POST', url: '/journal/task-1/entries', payload: { project_id: 'app-a', kind: 'agent_started' } });
    await app.inject({ method: 'POST', url: '/journal/task-2/entries', payload: { project_id: 'app-a', kind: 'run_complete' } });
    await app.inject({ method: 'POST', url: '/journal/task-3/entries', payload: { project_id: 'app-b', kind: 'note' } }); // different project

    const res = await app.inject({ method: 'GET', url: '/projects/app-a/journal?limit=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe('run_complete'); // most recent of app-a's two entries
  });
});
