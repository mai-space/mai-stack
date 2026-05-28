import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface Project {
  last_indexed_at: string | null;
  reindex_threshold_minutes: number;
}

async function fetchProject(registryUrl: string, projectId: string): Promise<Project | null> {
  try {
    const res = await fetch(`${registryUrl}/projects/${projectId}`);
    if (!res.ok) return null;
    return await res.json() as Project;
  } catch {
    return null;
  }
}

export interface FreshnessResult {
  staleWarning: string | null;
}

export async function checkFreshness(
  redis: RedisClient,
  projectId: string,
  registryUrl: string,
  codeMcpUrl: string,
  timeoutMs: number
): Promise<FreshnessResult> {
  const dirty = await redis.get(`project:${projectId}:dirty`);
  if (dirty !== '1') return { staleWarning: null };

  const project = await fetchProject(registryUrl, projectId);
  if (!project) {
    console.warn(`[freshness:${projectId}] project not in registry, skipping check`);
    return { staleWarning: null };
  }

  if (project.last_indexed_at) {
    const ageMinutes = (Date.now() - new Date(project.last_indexed_at).getTime()) / 60_000;
    if (ageMinutes <= project.reindex_threshold_minutes) {
      await redis.set(`project:${projectId}:dirty`, '0');
      return { staleWarning: null };
    }
  }

  return triggerAndAwaitReindex(redis, projectId, codeMcpUrl, timeoutMs);
}

async function triggerAndAwaitReindex(
  redis: RedisClient,
  projectId: string,
  codeMcpUrl: string,
  timeoutMs: number
): Promise<FreshnessResult> {
  console.log(`[freshness:${projectId}] triggering reindex`);

  try {
    const res = await fetch(`${codeMcpUrl}/reindex/${projectId}`, { method: 'POST' });
    if (!res.ok) {
      return { staleWarning: `WARNING: Reindex trigger failed (HTTP ${res.status}). Code context may be stale.` };
    }
  } catch (err) {
    return { staleWarning: `WARNING: Could not reach mai-code-mcp. Code context may be stale.` };
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      const statusRes = await fetch(`${codeMcpUrl}/reindex/${projectId}/status`);
      if (!statusRes.ok) continue;
      const body = await statusRes.json() as { status: string };

      if (body.status === 'done') {
        await redis.set(`project:${projectId}:dirty`, '0');
        console.log(`[freshness:${projectId}] reindex complete`);
        return { staleWarning: null };
      }
      if (body.status === 'error') {
        console.warn(`[freshness:${projectId}] reindex reported error`);
        return { staleWarning: 'WARNING: Reindex failed. Code context may be stale.' };
      }
    } catch {
      // keep polling
    }
  }

  console.warn(`[freshness:${projectId}] reindex timed out after ${timeoutMs}ms`);
  return {
    staleWarning: `WARNING: Code index is stale (reindex timed out after ${timeoutMs}ms). Search results may not reflect recent changes.`,
  };
}
