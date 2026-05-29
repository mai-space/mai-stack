import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { z } from 'zod';
import { publishStateChange } from '../redis.js';
import { expireLeases } from '../services/lease.js';

export async function projectRoutes(app: FastifyInstance, db: Kysely<Database>, redis: any) {
  app.get('/projects', async () => db.selectFrom('projects').selectAll().execute());

  app.get('/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return row;
  });

  app.post('/projects', async (req, reply) => {
    const body = z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      description: z.string().optional(),
    }).parse(req.body);
    const id = body.id ?? crypto.randomUUID();
    const existing = await db.selectFrom('projects').select('id').where('id', '=', id).executeTakeFirst();
    if (existing) return reply.status(409).send({ error: 'Project already exists' });
    const now = new Date().toISOString();
    await db.insertInto('projects').values({ id, name: body.name, description: body.description ?? null, created_at: now }).execute();
    return reply.status(201).send(await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
  });

  app.get('/projects/:id/tasks', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await db.selectFrom('projects').select('id').where('id', '=', id).executeTakeFirst();
    if (!project) return reply.status(404).send({ error: 'Not found' });
    await expireLeases(db, redis);
    return db.selectFrom('tasks').selectAll().where('project_id', '=', id).orderBy('priority', 'desc').execute();
  });

  app.post('/projects/:id/bulk-close-blocked', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await db.selectFrom('projects').select('id').where('id', '=', id).executeTakeFirst();
    if (!project) return reply.status(404).send({ error: 'Not found' });

    const body = z.object({
      blocker_types: z.array(z.string()).optional(),
    }).optional().parse(req.body ?? {});

    const now = new Date().toISOString();
    const tasks = await db.selectFrom('tasks').selectAll()
      .where('project_id', '=', id).where('status', '=', 'BLOCKED').execute();

    const types = body?.blocker_types ?? ['DECISION', 'CLARIFICATION', 'RISK', 'CAPABILITY', 'DEPENDENCY'];
    const targets = tasks.filter(t => t.blocker_type && types.includes(t.blocker_type));

    if (targets.length === 0) return { closed: 0, task_ids: [] };

    const ids = targets.map(t => t.id);
    await db.updateTable('tasks').set({ status: 'DONE', updated_at: now })
      .where('id', 'in', ids).execute();

    for (const t of targets) {
      await publishStateChange(redis, t.id, {
        task_id: t.id, project_id: id, from: 'BLOCKED', to: 'DONE',
        reason: 'bulk_close', blocker_type: t.blocker_type, timestamp: now,
      });
    }

    return { closed: ids.length, task_ids: ids };
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
