import { createClient } from 'redis';
import { fetchProjects } from './registry.js';
import { setupWatcher, stopWatcher, getActiveProjectIds } from './watcher.js';

const REDIS_URL = process.env.REDIS_URL;
const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';
const RESYNC_INTERVAL_MS = parseInt(process.env.RESYNC_INTERVAL_MS ?? '60000', 10);

type RedisClient = ReturnType<typeof createClient>;

async function syncProjects(redis: RedisClient): Promise<void> {
  const projects = await fetchProjects(REGISTRY_URL);
  const currentIds = new Set(getActiveProjectIds());
  const newIds = new Set(projects.map(p => p.id));

  for (const project of projects) {
    if (!currentIds.has(project.id)) setupWatcher(project, redis);
  }
  for (const id of currentIds) {
    if (!newIds.has(id)) stopWatcher(id);
  }

  console.log(`[sync] watching ${newIds.size} project(s)`);
}

async function main(): Promise<void> {
  if (!REDIS_URL) {
    console.error('[startup] REDIS_URL is required');
    process.exit(1);
  }

  const redis = createClient({ url: REDIS_URL });
  redis.on('error', (err: Error) => console.error('[redis] error:', err.message));
  await redis.connect();
  console.log('[redis] connected');

  await syncProjects(redis);

  const interval = setInterval(() => syncProjects(redis).catch(console.error), RESYNC_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(interval);
    for (const id of getActiveProjectIds()) stopWatcher(id);
    await redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: Error) => { console.error('Fatal:', err); process.exit(1); });
