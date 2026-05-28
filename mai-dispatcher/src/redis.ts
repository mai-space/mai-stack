import { createClient } from 'redis';

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
