import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;
let _redis: RedisClient | null = null;

export async function getRedis(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[redis] REDIS_URL not set — pub/sub disabled');
    return null;
  }
  if (!_redis) {
    _redis = createClient({ url });
    _redis.on('error', (err) => console.error('[redis] error:', err));
    await _redis.connect();
    console.log('[redis] connected');
  }
  return _redis;
}

export async function publishStateChange(
  redis: RedisClient | null,
  taskId: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!redis) return;
  await redis.publish(`task.${taskId}.state_changed`, JSON.stringify(payload));
}
