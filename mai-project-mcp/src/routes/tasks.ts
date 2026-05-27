import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { z } from 'zod';
import { onTaskDone } from '../services/blocker.js';
import { publishStateChange } from '../redis.js';

const LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function taskRoutes(app: FastifyInstance, db: Kysely<Database>, redis: any) {
  app.get('/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return row;
  });

  app.put('/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await db.selectFrom('tasks').select('id').where('id', '=', id).executeTakeFirst();
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    const body = z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.number().int().optional(),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'BLOCKED']).optional(),
    }).parse(req.body);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.status !== undefined) updates.status = body.status;
    await db.updateTable('tasks').set(updates).where('id', '=', id).execute();
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/claim', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { agent_id } = z.object({ agent_id: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.status !== 'OPEN') return reply.status(409).send({ error: `Task is ${task.status}` });
    const now = new Date().toISOString();
    const leaseExpires = new Date(Date.now() + LEASE_TTL_MS).toISOString();
    await db.updateTable('tasks').set({ status: 'IN_PROGRESS', assigned_agent: agent_id, lease_expires_at: leaseExpires, updated_at: now }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, from: 'OPEN', to: 'IN_PROGRESS', agent_id, timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/complete', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.status === 'DONE') return reply.status(409).send({ error: 'Already done' });
    const now = new Date().toISOString();
    await db.updateTable('tasks').set({ status: 'DONE', updated_at: now }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, from: task.status, to: 'DONE', timestamp: now });
    await onTaskDone(db, redis, id);
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/resolve-blocker', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { resolution } = z.object({ resolution: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.status !== 'BLOCKED') return reply.status(409).send({ error: 'Task is not blocked' });
    const now = new Date().toISOString();
    const payload = { ...(JSON.parse(task.blocker_payload || '{}')), resolution };
    await db.updateTable('tasks').set({
      status: 'OPEN', blocker_type: null, blocker_payload: JSON.stringify(payload),
      blocker_resolved_at: now, updated_at: now,
    }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, from: 'BLOCKED', to: 'OPEN', reason: 'manually_resolved', timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/renew-lease', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { agent_id } = z.object({ agent_id: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.assigned_agent !== agent_id) return reply.status(403).send({ error: 'Not your task' });
    const leaseExpires = new Date(Date.now() + LEASE_TTL_MS).toISOString();
    await db.updateTable('tasks').set({ lease_expires_at: leaseExpires, updated_at: new Date().toISOString() }).where('id', '=', id).execute();
    return { renewed: true, lease_expires_at: leaseExpires };
  });
}
