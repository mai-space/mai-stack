import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { rememberEntry, listMemories, recallMemories, forgetMemory } from '../redis.js';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

export async function memoryRoutes(app: FastifyInstance, redis: RedisClient): Promise<void> {
  app.get('/projects/:projectId/memories', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { limit, q } = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(50),
      q: z.string().optional(),
    }).parse(req.query);

    if (q) return recallMemories(redis, projectId, q, limit);
    return listMemories(redis, projectId, limit);
  });

  app.post('/projects/:projectId/memories', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z.object({
      key: z.string().min(1),
      value: z.string().min(1),
    }).parse(req.body);
    const memory = await rememberEntry(redis, projectId, body.key, body.value);
    return reply.status(201).send(memory);
  });

  app.get('/projects/:projectId/memories/recall', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const { q, limit } = z.object({
      q: z.string().default(''),
      limit: z.coerce.number().int().min(1).max(100).default(10),
    }).parse(req.query);
    return recallMemories(redis, projectId, q, limit);
  });

  app.delete('/projects/:projectId/memories/:key', async (req, reply) => {
    const { projectId, key } = req.params as { projectId: string; key: string };
    const deleted = await forgetMemory(redis, projectId, key);
    if (!deleted) return reply.status(404).send({ error: 'Memory not found' });
    return reply.status(204).send();
  });
}
