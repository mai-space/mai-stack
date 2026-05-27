import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { z } from 'zod';

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function projectRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get('/projects', async () => db.selectFrom('projects').selectAll().execute());

  app.get('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return row;
  });

  app.post('/projects', async (req, reply) => {
    const body = CreateSchema.parse(req.body);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insertInto('projects').values({ id, name: body.name, description: body.description ?? null, created_at: now }).execute();
    return reply.status(201).send(await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
  });

  app.get('/projects/:id/tasks', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await db.selectFrom('projects').select('id').where('id', '=', id).executeTakeFirst();
    if (!project) return reply.status(404).send({ error: 'Not found' });
    return db.selectFrom('tasks').selectAll().where('project_id', '=', id).orderBy('priority', 'desc').execute();
  });

  app.post('/projects/:id/tasks', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await db.selectFrom('projects').select('id').where('id', '=', id).executeTakeFirst();
    if (!project) return reply.status(404).send({ error: 'Not found' });
    const body = z.object({ title: z.string().min(1), description: z.string().optional(), priority: z.number().int().optional() }).parse(req.body);
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insertInto('tasks').values({
      id: taskId, project_id: id, title: body.title, description: body.description ?? null,
      status: 'OPEN', priority: body.priority ?? 0, assigned_agent: null, lease_expires_at: null,
      parent_task_id: null, blocker_type: null, blocker_payload: '{}', blocker_resolved_at: null,
      created_at: now, updated_at: now,
    }).execute();
    return reply.status(201).send(await db.selectFrom('tasks').selectAll().where('id', '=', taskId).executeTakeFirstOrThrow());
  });
}
