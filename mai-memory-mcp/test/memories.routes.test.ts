import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createFakeRedis } from './fakeRedis.js';
import { memoryRoutes } from '../src/routes/memories.js';

describe('mai-memory-mcp memory routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
      return reply.status(500).send({ error: 'Internal server error' });
    });
    const redis = createFakeRedis();
    await memoryRoutes(app, redis as any);
  });

  it('POST creates a memory and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects/app-a/memories',
      payload: { key: 'rate-limiter-choice', value: 'flexible-rate-limiter' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.key).toBe('rate-limiter-choice');
    expect(body.value).toBe('flexible-rate-limiter');
  });

  it('POST rejects a missing key with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { value: 'v' } });
    expect(res.statusCode).toBe(400);
  });

  it('GET lists memories most-recent-first', async () => {
    await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { key: 'a', value: '1' } });
    await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { key: 'b', value: '2' } });
    const res = await app.inject({ method: 'GET', url: '/projects/app-a/memories' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('GET with ?q= searches instead of listing', async () => {
    await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { key: 'db-choice', value: 'Postgres with Kysely' } });
    await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { key: 'auth', value: 'JWT refresh tokens' } });
    const res = await app.inject({ method: 'GET', url: '/projects/app-a/memories?q=postgres' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map((m: any) => m.key)).toContain('db-choice');
  });

  it('GET /recall ranks by query match', async () => {
    await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { key: 'db-choice', value: 'Postgres with Kysely' } });
    const res = await app.inject({ method: 'GET', url: '/projects/app-a/memories/recall?q=postgres%20kysely' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].key).toBe('db-choice');
  });

  it('DELETE removes an existing memory and returns 204', async () => {
    await app.inject({ method: 'POST', url: '/projects/app-a/memories', payload: { key: 'k', value: 'v' } });
    const res = await app.inject({ method: 'DELETE', url: '/projects/app-a/memories/k' });
    expect(res.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/projects/app-a/memories' });
    expect(list.json()).toHaveLength(0);
  });

  it('DELETE 404s for a key that does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/projects/app-a/memories/missing' });
    expect(res.statusCode).toBe(404);
  });
});
