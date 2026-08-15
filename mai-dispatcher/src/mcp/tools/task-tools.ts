import { z } from 'zod';
import { checkFreshness } from '../../freshness.js';
import { assembleManifest } from '../../manifest.js';
import { createClient } from 'redis';
import { getAgentProfiles } from '../../config.js';
import { checkGovernance, recordClaim, recordComplete, budgetKey, providerKey } from '../../governance.js';

type RedisClient = ReturnType<typeof createClient>;

const PROJECT_MCP_URL = process.env.PROJECT_MCP_URL ?? 'http://mai-project-mcp:3456';
const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';
const CODE_MCP_URL = process.env.CODE_MCP_URL ?? 'http://mai-code-mcp:3457';
const REINDEX_TIMEOUT_MS = parseInt(process.env.REINDEX_TIMEOUT_MS ?? '30000', 10);

interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  parent_task_id: string | null;
  assigned_agent: string | null;
  lease_expires_at: string | null;
  blocker_type: string | null;
  blocker_payload: string;
  blocker_resolved_at: string | null;
  created_at: string;
}

async function proxyPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${PROJECT_MCP_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function claimNextTask(projectId: string, agentId: string): Promise<Task | null> {
  let tasks: Task[] = [];
  try {
    const res = await fetch(`${PROJECT_MCP_URL}/projects/${projectId}/tasks`);
    if (!res.ok) return null;
    tasks = await res.json() as Task[];
  } catch {
    return null;
  }

  const openTasks = tasks
    .filter(t => t.status === 'OPEN')
    .sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));

  for (const task of openTasks) {
    try {
      const res = await fetch(`${PROJECT_MCP_URL}/tasks/${task.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      });
      if (res.ok) return await res.json() as Task;
      if (res.status === 409) continue;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchAllowedAgentIds(projectId: string): Promise<string[]> {
  try {
    const res = await fetch(`${REGISTRY_URL}/projects/${projectId}`);
    if (!res.ok) return [];
    const proj = await res.json() as { allowed_agent_ids?: unknown };
    if (Array.isArray(proj.allowed_agent_ids)) return proj.allowed_agent_ids as string[];
    if (typeof proj.allowed_agent_ids === 'string') {
      try { return JSON.parse(proj.allowed_agent_ids); } catch { return []; }
    }
    return [];
  } catch {
    return [];
  }
}

export function registerTaskTools(server: any, redis: RedisClient): void {
  server.tool(
    'claim_task',
    {
      project_id: z.string().describe('Project ID to claim a task from'),
      agent_id: z.string().describe('Agent ID claiming the task'),
    },
    async ({ project_id, agent_id }: { project_id: string; agent_id: string }) => {
      const profile = getAgentProfiles().find(p => p.id === agent_id);

      // Affinity gate — runs before governance to avoid unnecessary Redis reads
      if (profile?.project_affinity && profile.project_affinity.length > 0) {
        if (!profile.project_affinity.includes(project_id)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                task: null,
                reason: 'project_not_in_affinity',
                affinity: profile.project_affinity,
              }),
            }],
          };
        }
      }

      if (profile) {
        const allowedAgentIds = await fetchAllowedAgentIds(project_id);
        const gov = await checkGovernance(redis, agent_id, profile, allowedAgentIds);
        if (!gov.allowed) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ task: null, reason: gov.reason, retry_after: gov.retry_after }),
            }],
          };
        }
      } else {
        console.warn(`[governance] unknown agent "${agent_id}" — governance checks skipped`);
      }

      const { staleWarning } = await checkFreshness(redis, project_id, REGISTRY_URL, CODE_MCP_URL, REINDEX_TIMEOUT_MS);

      const task = await claimNextTask(project_id, agent_id);
      if (!task) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ task: null, reason: 'no_tasks_available' }) }] };
      }

      if (profile) {
        await recordClaim(redis, agent_id, profile);
      }

      const manifest = await assembleManifest(task, agent_id, staleWarning);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ task, context_manifest: manifest, lease_expires_at: task.lease_expires_at }),
        }],
      };
    }
  );

  server.tool(
    'complete_task',
    {
      task_id: z.string().describe('Task ID to mark as complete'),
      agent_id: z.string().optional().describe('Agent ID; updates budget and concurrency'),
      cost_usd: z.number().optional().describe('Actual task cost in USD; adjusts the per_task_usd estimate'),
    },
    async ({ task_id, agent_id, cost_usd }: { task_id: string; agent_id?: string; cost_usd?: number }) => {
      const result = await proxyPost(`/tasks/${task_id}/complete`, {});

      if (agent_id) {
        const profile = getAgentProfiles().find(p => p.id === agent_id);
        if (profile) {
          if (cost_usd !== undefined && profile.budget?.per_task_usd !== undefined) {
            const delta = cost_usd - profile.budget.per_task_usd;
            if (delta !== 0) {
              await redis.incrByFloat(budgetKey(agent_id), delta);
              await redis.incrByFloat(providerKey(profile.model_provider), delta);
            }
          }
          await recordComplete(redis, agent_id);
        }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'renew_lease',
    { task_id: z.string(), agent_id: z.string() },
    async ({ task_id, agent_id }: { task_id: string; agent_id: string }) => {
      const result = await proxyPost(`/tasks/${task_id}/renew-lease`, { agent_id });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'create_subtask',
    {
      parent_task_id: z.string(),
      title: z.string(),
      description: z.string(),
      priority: z.number().int().optional(),
    },
    async ({ parent_task_id, title, description, priority = 0 }: { parent_task_id: string; title: string; description: string; priority?: number }) => {
      const result = await proxyPost(`/tasks/${parent_task_id}/subtask`, { title, description, priority });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'request_decision',
    { task_id: z.string(), question: z.string(), options: z.array(z.string()) },
    async ({ task_id, question, options }: { task_id: string; question: string; options: string[] }) => {
      const result = await proxyPost(`/tasks/${task_id}/block/decision`, { question, options });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'request_clarification',
    { task_id: z.string(), question: z.string() },
    async ({ task_id, question }: { task_id: string; question: string }) => {
      const result = await proxyPost(`/tasks/${task_id}/block/clarification`, { question });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'flag_risk',
    { task_id: z.string(), description: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']) },
    async ({ task_id, description, severity }: { task_id: string; description: string; severity: string }) => {
      const result = await proxyPost(`/tasks/${task_id}/block/risk`, { description, severity });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'reassign_task',
    { task_id: z.string(), required_capability: z.string(), reason: z.string() },
    async ({ task_id, required_capability, reason }: { task_id: string; required_capability: string; reason: string }) => {
      const result = await proxyPost(`/tasks/${task_id}/reassign`, { required_capability, reason });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );
}
