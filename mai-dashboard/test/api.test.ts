import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { apiRoutes } from '../server/routes/api.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as any;
}

describe('dashboard api routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(apiRoutes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/overview aggregates per-project task counts and escalations', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'http://mai-registry:3459/projects') return jsonResponse([{ id: 'app-a', name: 'App A' }]);
      if (u === 'http://mai-project-mcp:3456/projects/app-a/tasks') {
        return jsonResponse([
          { id: '1', status: 'OPEN', blocker_type: null },
          { id: '2', status: 'IN_PROGRESS', blocker_type: null },
          { id: '3', status: 'BLOCKED', blocker_type: 'DECISION' },
          { id: '4', status: 'DONE', blocker_type: null },
        ]);
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;

    const res = await app.inject({ method: 'GET', url: '/overview' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: 'app-a', name: 'App A', open: 1, inProgress: 1, blocked: 1, done: 1, escalations: 1 }]);
  });

  it('/escalations sorts RISK above other blocker types, and by severity within RISK', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'http://mai-registry:3459/projects') return jsonResponse([{ id: 'app-a', name: 'App A' }]);
      if (u === 'http://mai-project-mcp:3456/projects/app-a/tasks') {
        const base = { created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' };
        return jsonResponse([
          { id: 'dec', title: 'Decision task', status: 'BLOCKED', blocker_type: 'DECISION', blocker_payload: '{}', ...base },
          { id: 'risk-low', title: 'Low risk', status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"low"}', ...base },
          { id: 'risk-critical', title: 'Critical risk', status: 'BLOCKED', blocker_type: 'RISK', blocker_payload: '{"severity":"critical"}', ...base },
          { id: 'done', title: 'irrelevant', status: 'DONE', blocker_type: null, blocker_payload: '{}', ...base },
        ]);
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;

    const res = await app.inject({ method: 'GET', url: '/escalations' });
    expect(res.json().map((e: { task_id: string }) => e.task_id)).toEqual(['risk-critical', 'risk-low', 'dec']);
  });

  it('/projects/:id/tasks 404s for an unknown project', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === 'http://mai-project-mcp:3456/projects/missing/tasks') return jsonResponse([]);
      if (u === 'http://mai-project-mcp:3456/projects/missing') return jsonResponse(null, false, 404);
      throw new Error(`unexpected fetch ${u}`);
    }) as any;

    const res = await app.inject({ method: 'GET', url: '/projects/missing/tasks' });
    expect(res.statusCode).toBe(404);
  });

  it('proxies bulk-close-blocked to mai-project-mcp and forwards the response', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ closed: 2, task_ids: ['a', 'b'] }));
    const res = await app.inject({ method: 'POST', url: '/projects/app-a/bulk-close-blocked' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ closed: 2, task_ids: ['a', 'b'] });
  });

  it('proxies task journal reads to mai-journal', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([{ id: '1', kind: 'note' }]));
    const res = await app.inject({ method: 'GET', url: '/tasks/task-1/journal' });
    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith('http://mai-journal:3462/journal/task-1/entries');
  });

  it('proxies active runs and kill requests to mai-runner', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse([{ taskId: 't1' }]));
    const list = await app.inject({ method: 'GET', url: '/runs' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([{ taskId: 't1' }]);

    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ task_id: 't1', killed: true }));
    const kill = await app.inject({ method: 'POST', url: '/runs/t1/kill' });
    expect(kill.json()).toEqual({ task_id: 't1', killed: true });
  });

  it('returns 502 when the upstream service is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await app.inject({ method: 'POST', url: '/agents/agent-1/resume' });
    expect(res.statusCode).toBe(502);
  });
});
