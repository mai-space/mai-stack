import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTestDb, migrateTestDb } from './testDb.js';
import { projectRoutes } from '../src/routes/projects.js';

describe('mai-registry projects routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db = createTestDb();
    await migrateTestDb(db);
    app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
      return reply.status(500).send({ error: 'Internal server error' });
    });
    await projectRoutes(app, db);
  });

  it('creates a project and returns 201 with registry defaults applied', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { id: 'app-a', name: 'App A', workspace_path: '/workspaces/app-a' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe('app-a');
    expect(body.allowed_agent_ids).toEqual([]);
    expect(body.embedding_model).toBe('ollama:nomic-embed-text');
    expect(body.index_health).toBe('unknown');
  });

  it('rejects a duplicate project id with 409', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'app-a', name: 'App A', workspace_path: '/w' } });
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { id: 'app-a', name: 'Dup', workspace_path: '/w' } });
    expect(res.statusCode).toBe(409);
  });

  it('rejects a missing required field with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/projects', payload: { id: 'app-a' } });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown project', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects/missing' });
    expect(res.statusCode).toBe(404);
  });

  it('lists all projects', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A', workspace_path: '/a' } });
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'b', name: 'B', workspace_path: '/b' } });
    const res = await app.inject({ method: 'GET', url: '/projects' });
    expect(res.json()).toHaveLength(2);
  });

  it('PUT updates only the given fields, leaving the rest untouched', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A', workspace_path: '/a', embedding_model: 'openai:text-embedding-3-small' } });
    const res = await app.inject({ method: 'PUT', url: '/projects/a', payload: { name: 'A renamed' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('A renamed');
    expect(body.embedding_model).toBe('openai:text-embedding-3-small');
  });

  it('PUT 404s for an unknown project', async () => {
    const res = await app.inject({ method: 'PUT', url: '/projects/missing', payload: { name: 'X' } });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH index-status updates last_indexed_at and index_health', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A', workspace_path: '/a' } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/a/index-status',
      payload: { last_indexed_at: '2026-01-01T00:00:00.000Z', index_health: 'healthy' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.index_health).toBe('healthy');
    expect(body.last_indexed_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('deletes a project', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A', workspace_path: '/a' } });
    const del = await app.inject({ method: 'DELETE', url: '/projects/a' });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: '/projects/a' });
    expect(get.statusCode).toBe(404);
  });

  it('round-trips allowed_agent_ids as parsed JSON', async () => {
    await app.inject({ method: 'POST', url: '/projects', payload: { id: 'a', name: 'A', workspace_path: '/a', allowed_agent_ids: ['x', 'y'] } });
    const res = await app.inject({ method: 'GET', url: '/projects/a' });
    expect(res.json().allowed_agent_ids).toEqual(['x', 'y']);
  });
});
