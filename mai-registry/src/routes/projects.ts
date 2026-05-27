import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

const CreateProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().optional(),
  workspace_path: z.string().min(1),
  agents_md_path: z.string().optional(),
  system_prompt_override: z.string().optional(),
  allowed_agent_ids: z.array(z.string()).optional(),
  embedding_model: z.string().optional(),
  reindex_threshold_minutes: z.number().int().positive().optional(),
});

const UpdateProjectSchema = CreateProjectSchema.partial().omit({ id: true });

const IndexStatusSchema = z.object({
  last_indexed_at: z.string(),
  index_health: z.enum(['unknown', 'healthy', 'stale', 'error']),
});

function parseProject(row: any) {
  return {
    ...row,
    allowed_agent_ids: JSON.parse(row.allowed_agent_ids ?? '[]'),
  };
}

export async function projectRoutes(app: FastifyInstance, db: Kysely<Database>): Promise<void> {
  app.get('/projects', async () => {
    const rows = await db.selectFrom('projects').selectAll().execute();
    return rows.map(parseProject);
  });

  app.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) return reply.status(404).send({ error: 'Not found' });
    return parseProject(row);
  });

  app.post('/projects', async (request, reply) => {
    const body = CreateProjectSchema.parse(request.body);
    const now = new Date().toISOString();
    try {
      await db
        .insertInto('projects')
        .values({
          id: body.id,
          name: body.name,
          slug: body.slug ?? body.id,
          workspace_path: body.workspace_path,
          agents_md_path: body.agents_md_path ?? null,
          system_prompt_override: body.system_prompt_override ?? null,
          allowed_agent_ids: JSON.stringify(body.allowed_agent_ids ?? []),
          embedding_model: body.embedding_model ?? 'ollama:nomic-embed-text',
          reindex_threshold_minutes: body.reindex_threshold_minutes ?? 15,
          last_indexed_at: null,
          index_health: 'unknown',
          created_at: now,
          updated_at: now,
        })
        .execute();
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: 'Project with this id already exists' });
      }
      throw err;
    }
    const row = await db.selectFrom('projects').selectAll().where('id', '=', body.id).executeTakeFirstOrThrow();
    return reply.status(201).send(parseProject(row));
  });

  app.put('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateProjectSchema.parse(request.body);
    const existing = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) return reply.status(404).send({ error: 'Not found' });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.slug !== undefined) updates.slug = body.slug;
    if (body.workspace_path !== undefined) updates.workspace_path = body.workspace_path;
    if (body.agents_md_path !== undefined) updates.agents_md_path = body.agents_md_path;
    if (body.system_prompt_override !== undefined) updates.system_prompt_override = body.system_prompt_override;
    if (body.allowed_agent_ids !== undefined) updates.allowed_agent_ids = JSON.stringify(body.allowed_agent_ids);
    if (body.embedding_model !== undefined) updates.embedding_model = body.embedding_model;
    if (body.reindex_threshold_minutes !== undefined) updates.reindex_threshold_minutes = body.reindex_threshold_minutes;

    await db.updateTable('projects').set(updates).where('id', '=', id).execute();
    const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    return parseProject(row);
  });

  app.delete('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    await db.deleteFrom('projects').where('id', '=', id).execute();
    return reply.status(204).send();
  });

  app.patch('/projects/:id/index-status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = IndexStatusSchema.parse(request.body);
    const existing = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirst();
    if (!existing) return reply.status(404).send({ error: 'Not found' });
    await db
      .updateTable('projects')
      .set({ last_indexed_at: body.last_indexed_at, index_health: body.index_health, updated_at: new Date().toISOString() })
      .where('id', '=', id)
      .execute();
    const row = await db.selectFrom('projects').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    return parseProject(row);
  });
}
