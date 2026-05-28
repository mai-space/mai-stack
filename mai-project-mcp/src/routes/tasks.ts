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

  app.post('/tasks/:id/subtask', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ title: z.string().min(1), description: z.string(), priority: z.number().int().optional() }).parse(req.body);
    const parent = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!parent) return reply.status(404).send({ error: 'Parent task not found' });
    const subtaskId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('tasks').values({
        id: subtaskId, project_id: parent.project_id, title: body.title, description: body.description,
        status: 'OPEN', priority: body.priority ?? 0, assigned_agent: null, lease_expires_at: null,
        parent_task_id: id, blocker_type: null, blocker_payload: '{}', blocker_resolved_at: null,
        created_at: now, updated_at: now,
      }).execute();
      await trx.updateTable('tasks').set({
        status: 'BLOCKED', blocker_type: 'SUBTASK',
        blocker_payload: JSON.stringify({ subtask_id: subtaskId }), updated_at: now,
      }).where('id', '=', id).execute();
    });
    await publishStateChange(redis, id, { task_id: id, from: parent.status, to: 'BLOCKED', blocker_type: 'SUBTASK', subtask_id: subtaskId, timestamp: now });
    return reply.status(201).send({ subtask_id: subtaskId, parent_task_id: id });
  });

  app.post('/tasks/:id/block/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ question: z.string(), options: z.array(z.string()) }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    const now = new Date().toISOString();
    await db.updateTable('tasks').set({ status: 'BLOCKED', blocker_type: 'DECISION', blocker_payload: JSON.stringify(body), updated_at: now }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, from: task.status, to: 'BLOCKED', blocker_type: 'DECISION', timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/block/clarification', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ question: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    const now = new Date().toISOString();
    await db.updateTable('tasks').set({ status: 'BLOCKED', blocker_type: 'CLARIFICATION', blocker_payload: JSON.stringify(body), updated_at: now }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, from: task.status, to: 'BLOCKED', blocker_type: 'CLARIFICATION', timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/block/risk', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ description: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']) }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    const now = new Date().toISOString();
    await db.updateTable('tasks').set({ status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: JSON.stringify(body), updated_at: now }).where('id', '=', id).execute();
    if (body.severity === 'critical') {
      await db.updateTable('tasks').set({ status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: JSON.stringify({ description: `Blocked by critical risk on task ${id}`, severity: 'critical' }), updated_at: now })
        .where('project_id', '=', task.project_id).where('status', '=', 'IN_PROGRESS').where('id', '!=', id).execute();
    }
    await publishStateChange(redis, id, { task_id: id, from: task.status, to: 'BLOCKED', blocker_type: 'RISK', severity: body.severity, timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/resolve/decision', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { choice } = z.object({ choice: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.status !== 'BLOCKED') return reply.status(409).send({ error: 'Task is not blocked' });
    if (task.blocker_type !== 'DECISION') return reply.status(409).send({ error: `Task is blocked by ${task.blocker_type}, not DECISION` });
    const now = new Date().toISOString();
    const payload = { ...(JSON.parse(task.blocker_payload || '{}')), choice };
    await db.updateTable('tasks').set({
      status: 'OPEN', assigned_agent: null, lease_expires_at: null,
      blocker_payload: JSON.stringify(payload), blocker_resolved_at: now, updated_at: now,
    }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, project_id: task.project_id, from: 'BLOCKED', to: 'OPEN', blocker_type: 'DECISION', choice, timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/resolve/clarification', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { response } = z.object({ response: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.status !== 'BLOCKED') return reply.status(409).send({ error: 'Task is not blocked' });
    if (task.blocker_type !== 'CLARIFICATION') return reply.status(409).send({ error: `Task is blocked by ${task.blocker_type}, not CLARIFICATION` });
    const now = new Date().toISOString();
    const payload = { ...(JSON.parse(task.blocker_payload || '{}')), response };
    const newDescription = (task.description ?? '') + `\n\nClarification: ${response}`;
    await db.updateTable('tasks').set({
      status: 'OPEN', assigned_agent: null, lease_expires_at: null,
      description: newDescription,
      blocker_payload: JSON.stringify(payload), blocker_resolved_at: now, updated_at: now,
    }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, project_id: task.project_id, from: 'BLOCKED', to: 'OPEN', blocker_type: 'CLARIFICATION', timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/resolve/risk', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ approved: z.boolean(), notes: z.string().optional() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    if (task.status !== 'BLOCKED') return reply.status(409).send({ error: 'Task is not blocked' });
    if (task.blocker_type !== 'RISK') return reply.status(409).send({ error: `Task is blocked by ${task.blocker_type}, not RISK` });
    const now = new Date().toISOString();
    const existing = JSON.parse(task.blocker_payload || '{}') as { severity?: string };
    const payload = { ...existing, approved: body.approved, notes: body.notes };
    const newStatus = body.approved ? 'OPEN' : 'DONE';
    await db.updateTable('tasks').set({
      status: newStatus, assigned_agent: null, lease_expires_at: null,
      blocker_payload: JSON.stringify(payload), blocker_resolved_at: now, updated_at: now,
    }).where('id', '=', id).execute();
    if (body.approved && existing.severity === 'critical') {
      await db.updateTable('tasks')
        .set({ status: 'OPEN', blocker_type: null, blocker_payload: '{}', updated_at: now })
        .where('project_id', '=', task.project_id)
        .where('status', '=', 'BLOCKED')
        .where('blocker_type', '=', 'RISK')
        .where('id', '!=', id)
        .execute();
    }
    await publishStateChange(redis, id, { task_id: id, project_id: task.project_id, from: 'BLOCKED', to: newStatus, blocker_type: 'RISK', approved: body.approved, timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });

  app.post('/tasks/:id/reassign', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ required_capability: z.string(), reason: z.string() }).parse(req.body);
    const task = await db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirst();
    if (!task) return reply.status(404).send({ error: 'Not found' });
    const now = new Date().toISOString();
    await db.updateTable('tasks').set({ status: 'OPEN', assigned_agent: null, lease_expires_at: null, blocker_type: 'CAPABILITY', blocker_payload: JSON.stringify(body), updated_at: now }).where('id', '=', id).execute();
    await publishStateChange(redis, id, { task_id: id, from: task.status, to: 'OPEN', blocker_type: 'CAPABILITY', ...body, timestamp: now });
    return db.selectFrom('tasks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });
}
