import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const CODE_MCP_URL = process.env.CODE_MCP_URL ?? 'http://mai-code-mcp:3457';
const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';

function msUntilThreeAm(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function fetchAllProjectIds(): Promise<string[]> {
  try {
    const res = await fetch(`${REGISTRY_URL}/projects`);
    if (!res.ok) return [];
    const projects = await res.json() as { id: string }[];
    return projects.map(p => p.id);
  } catch {
    return [];
  }
}

async function reindexProject(projectId: string): Promise<void> {
  try {
    const res = await fetch(`${CODE_MCP_URL}/reindex/${projectId}`, { method: 'POST' });
    if (!res.ok) {
      console.warn(`[scheduler] reindex ${projectId} HTTP ${res.status}`);
      return;
    }
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const status = await fetch(`${CODE_MCP_URL}/reindex/${projectId}/status`);
        if (!status.ok) continue;
        const body = await status.json() as { status: string };
        if (body.status === 'done' || body.status === 'error') break;
      } catch { /* keep polling */ }
    }
    console.log(`[scheduler] reindex ${projectId} complete`);
  } catch (err) {
    console.warn(`[scheduler] reindex ${projectId} failed:`, String(err));
  }
}

async function runNightlyReindex(_redis: RedisClient): Promise<void> {
  console.log('[scheduler] nightly full-reindex starting');
  const projectIds = await fetchAllProjectIds();
  console.log(`[scheduler] ${projectIds.length} project(s) to reindex`);
  for (const id of projectIds) {
    await reindexProject(id);
  }
  console.log('[scheduler] nightly full-reindex complete');
}

export function startScheduler(redis: RedisClient): void {
  const delay = msUntilThreeAm();
  console.log(`[scheduler] next nightly reindex in ${Math.round(delay / 60_000)} minutes`);

  setTimeout(async function tick() {
    await runNightlyReindex(redis);
    setTimeout(tick, msUntilThreeAm());
  }, delay);
}
