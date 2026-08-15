import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database, JournalEntryKind } from '../db/schema.js';
import { publishEntry } from '../redis.js';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const KindSchema = z.enum([
  'agent_started',
  'agent_output',
  'gate_result',
  'agent_finished',
  'run_complete',
  'error',
  'note',
]);

const AppendSchema = z.object({
  project_id: z.string().optional(),
  agent_id: z.string().optional(),
  kind: KindSchema,
  payload: z.unknown().optional().default({}),
});

function parseEntry(row: { payload: string; kind: string; [k: string]: unknown }) {
  let payload: unknown = {};
  try { payload = JSON.parse(row.payload); } catch { /* leave as {} */ }
  return { ...row, payload };
}

export async function entryRoutes(app: FastifyInstance, db: Kysely<Database>, redis: RedisClient): Promise<void> {
  app.post('/journal/:taskId/entries', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const body = AppendSchema.parse(req.body);
    const now = new Date().toISOString();
    const kind: JournalEntryKind = body.kind;

    const row = await db.insertInto('journal_entries').values({
      task_id: taskId,
      project_id: body.project_id ?? null,
      agent_id: body.agent_id ?? null,
      kind,
      payload: JSON.stringify(body.payload ?? {}),
      created_at: now,
    }).returningAll().executeTakeFirstOrThrow();

    const entry = parseEntry(row);
    await publishEntry(redis, taskId, entry);

    return reply.status(201).send(entry);
  });

  app.get('/journal/:taskId/entries', async (req) => {
    const { taskId } = req.params as { taskId: string };
    const { since, limit } = z.object({
      // A monotonic id, not a timestamp — safe to use as a "give me everything after this" cursor
      // even when multiple entries land in the same millisecond (e.g. streamed model output).
      since: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(200),
    }).parse(req.query);

    let query = db.selectFrom('journal_entries').selectAll().where('task_id', '=', taskId);
    if (since !== undefined) query = query.where('id', '>', since);
    const rows = await query.orderBy('id', 'asc').limit(limit).execute();
    return rows.map(parseEntry);
  });

  app.get('/projects/:projectId/journal', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { limit } = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(50),
    }).parse(req.query);

    const rows = await db.selectFrom('journal_entries')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(parseEntry);
  });
}
