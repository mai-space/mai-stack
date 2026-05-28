import { createClient } from 'redis';
import { randomUUID } from 'crypto';

type RedisClient = ReturnType<typeof createClient>;
let _redis: RedisClient | null = null;

export async function getRedis(): Promise<RedisClient> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is required');
  if (!_redis) {
    _redis = createClient({ url });
    _redis.on('error', (err: Error) => console.error('[redis] error:', err.message));
    await _redis.connect();
    console.log('[redis] connected');
  }
  return _redis;
}

export interface Memory {
  id: string;
  project_id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export async function rememberEntry(
  redis: RedisClient,
  projectId: string,
  key: string,
  value: string
): Promise<Memory & { created: boolean }> {
  const now = new Date().toISOString();
  const existingId = await redis.hGet(`memory:${projectId}:key-index`, key);

  if (existingId) {
    await redis.hSet(`memory:${projectId}:${existingId}`, { value, updated_at: now });
    const raw = await redis.hGetAll(`memory:${projectId}:${existingId}`);
    return { ...(raw as unknown as Memory), created: false };
  }

  const id = randomUUID();
  const memory: Memory = { id, project_id: projectId, key, value, created_at: now, updated_at: now };
  await redis.hSet(`memory:${projectId}:${id}`, memory as unknown as Record<string, string>);
  await redis.zAdd(`memory:${projectId}:index`, { score: Date.now(), value: id });
  await redis.hSet(`memory:${projectId}:key-index`, { [key]: id });
  return { ...memory, created: true };
}

export async function listMemories(
  redis: RedisClient,
  projectId: string,
  limit = 50
): Promise<Memory[]> {
  const ids = await redis.zRange(`memory:${projectId}:index`, 0, limit - 1, { REV: true });
  const memories: Memory[] = [];
  for (const id of ids) {
    const raw = await redis.hGetAll(`memory:${projectId}:${id}`);
    if (raw && raw.id) memories.push(raw as unknown as Memory);
  }
  return memories;
}

export async function recallMemories(
  redis: RedisClient,
  projectId: string,
  query: string,
  limit = 10
): Promise<Array<Memory & { score: number }>> {
  const all = await listMemories(redis, projectId, 500);
  if (!query.trim()) return all.slice(0, limit).map(m => ({ ...m, score: 0 }));

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = all.map(m => {
    const text = (m.key + ' ' + m.value).toLowerCase();
    const score = terms.filter(t => text.includes(t)).length;
    return { ...m, score };
  });

  return scored
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

export async function forgetMemory(
  redis: RedisClient,
  projectId: string,
  key: string
): Promise<boolean> {
  const id = await redis.hGet(`memory:${projectId}:key-index`, key);
  if (!id) return false;
  await redis.del(`memory:${projectId}:${id}`);
  await redis.zRem(`memory:${projectId}:index`, id);
  await redis.hDel(`memory:${projectId}:key-index`, key);
  return true;
}
