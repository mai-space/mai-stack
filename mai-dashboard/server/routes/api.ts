import type { FastifyPluginAsync } from 'fastify';

const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';
const PROJECT_MCP_URL = process.env.PROJECT_MCP_URL ?? 'http://mai-project-mcp:3456';
const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';
const JOURNAL_URL = process.env.JOURNAL_URL ?? 'http://mai-journal:3462';
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://mai-runner:3463';

interface RegistryProject {
  id: string;
  name: string;
}

interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assigned_agent: string | null;
  blocker_type: string | null;
  blocker_payload: string;
  blocker_resolved_at: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentProfile {
  id: string;
  type: string;
  model_provider: string;
  model: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function fetchAllProjects(): Promise<RegistryProject[]> {
  const projects = await fetchJson<RegistryProject[]>(`${REGISTRY_URL}/projects`);
  return projects ?? [];
}

async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const tasks = await fetchJson<Task[]>(`${PROJECT_MCP_URL}/projects/${projectId}/tasks`);
  return tasks ?? [];
}

export const apiRoutes: FastifyPluginAsync = async (app) => {
  app.get('/overview', async () => {
    const projects = await fetchAllProjects();
    const results = await Promise.all(projects.map(async (p) => {
      const tasks = await fetchProjectTasks(p.id);
      const open = tasks.filter(t => t.status === 'OPEN').length;
      const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;
      const blocked = tasks.filter(t => t.status === 'BLOCKED').length;
      const done = tasks.filter(t => t.status === 'DONE').length;
      const escalations = tasks.filter(t =>
        t.status === 'BLOCKED' && ['DECISION', 'CLARIFICATION', 'RISK'].includes(t.blocker_type ?? '')
      ).length;
      return { id: p.id, name: p.name, open, inProgress, blocked, done, escalations };
    }));
    return results;
  });

  app.get('/escalations', async () => {
    const projects = await fetchAllProjects();
    const allEscalations: unknown[] = [];
    for (const p of projects) {
      const tasks = await fetchProjectTasks(p.id);
      for (const t of tasks) {
        if (t.status !== 'BLOCKED') continue;
        if (!['DECISION', 'CLARIFICATION', 'RISK'].includes(t.blocker_type ?? '')) continue;
        let bp: Record<string, unknown> = {};
        try { bp = JSON.parse(t.blocker_payload); } catch { /* ignore */ }
        allEscalations.push({
          task_id: t.id,
          task_title: t.title,
          project_id: p.id,
          project_name: p.name,
          blocker_type: t.blocker_type,
          question: bp.question as string | undefined,
          options: bp.options as string[] | undefined,
          description: bp.description as string | undefined,
          severity: bp.severity as string | undefined,
          created_at: t.created_at,
          updated_at: t.updated_at,
        });
      }
    }
    allEscalations.sort((a, b) => {
      const ae = a as { blocker_type: string; severity?: string; created_at: string };
      const be = b as { blocker_type: string; severity?: string; created_at: string };
      const severityOrder = (s?: string) => s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : 3;
      if (ae.blocker_type === 'RISK' && be.blocker_type !== 'RISK') return -1;
      if (ae.blocker_type !== 'RISK' && be.blocker_type === 'RISK') return 1;
      if (ae.blocker_type === 'RISK' && be.blocker_type === 'RISK') {
        const sd = severityOrder(ae.severity) - severityOrder(be.severity);
        if (sd !== 0) return sd;
      }
      return new Date(ae.created_at).getTime() - new Date(be.created_at).getTime();
    });
    return allEscalations;
  });

  app.get('/agents', async () => {
    const profiles = await fetchJson<AgentProfile[]>(`${DISPATCHER_URL}/agents`) ?? [];
    const results = await Promise.all(profiles.map(async (p) => {
      const budget = await fetchJson<Record<string, unknown>>(`${DISPATCHER_URL}/agents/${p.id}/budget`);
      return { ...p, ...(budget ?? { state: 'UNKNOWN', spent_usd: 0, pct: 0, active_tasks: 0 }) };
    }));
    return results;
  });

  app.get('/projects/:id/tasks', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tasks = await fetchProjectTasks(id);
    if (tasks.length === 0) {
      const check = await fetchJson(`${PROJECT_MCP_URL}/projects/${id}`);
      if (!check) return reply.status(404).send({ error: 'Not found' });
    }
    return tasks;
  });

  app.post<{ Params: { taskId: string; type: string } }>('/tasks/:taskId/resolve/:type', async (req, reply) => {
    const { taskId, type } = req.params;
    try {
      const res = await fetch(`${PROJECT_MCP_URL}/tasks/${taskId}/resolve/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const data: unknown = await res.json();
      return reply.status(res.status).send(data);
    } catch (err) {
      return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
    }
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/bulk-close-blocked', async (req, reply) => {
    const { projectId } = req.params;
    try {
      const res = await fetch(`${PROJECT_MCP_URL}/projects/${projectId}/bulk-close-blocked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
      });
      const data: unknown = await res.json();
      return reply.status(res.status).send(data);
    } catch (err) {
      return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
    }
  });

  app.post<{ Params: { agentId: string } }>('/agents/:agentId/resume', async (req, reply) => {
    const { agentId } = req.params;
    try {
      const res = await fetch(`${DISPATCHER_URL}/agents/${agentId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data: unknown = await res.json();
      return reply.status(res.status).send(data);
    } catch (err) {
      return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
    }
  });

  app.get<{ Params: { taskId: string } }>('/tasks/:taskId/journal', async (req, reply) => {
    const { taskId } = req.params;
    try {
      const res = await fetch(`${JOURNAL_URL}/journal/${taskId}/entries`);
      const data: unknown = await res.json();
      return reply.status(res.status).send(data);
    } catch (err) {
      return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
    }
  });

  app.get('/runs', async (_req, reply) => {
    try {
      const res = await fetch(`${RUNNER_URL}/runs`);
      const data: unknown = await res.json();
      return reply.status(res.status).send(data);
    } catch (err) {
      return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
    }
  });

  app.post<{ Params: { taskId: string } }>('/runs/:taskId/kill', async (req, reply) => {
    const { taskId } = req.params;
    try {
      const res = await fetch(`${RUNNER_URL}/runs/${taskId}/kill`, { method: 'POST' });
      const data: unknown = await res.json();
      return reply.status(res.status).send(data);
    } catch (err) {
      return reply.status(502).send({ error: 'Upstream error', detail: String(err) });
    }
  });
};
