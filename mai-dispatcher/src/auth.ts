import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

const DEFAULT_TTL_SECONDS = 3600;

function sessionKey(token: string): string {
  return `dispatcher:session:${token}`;
}

/**
 * Off by default — mirrors the DASHBOARD_SECRET dev-mode bypass from M5.
 * Set true only once mai-dispatcher is reachable from outside localhost
 * (see M-6.md "Dispatcher: session auth").
 */
export function isAuthRequired(): boolean {
  return process.env.DISPATCHER_AUTH_REQUIRED === 'true';
}

export interface Session {
  token: string;
  expires_at: string;
}

export async function issueSession(
  redis: RedisClient,
  agentId: string,
  opts: { taskId?: string; ttlSeconds?: number } = {}
): Promise<Session> {
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const token = randomBytes(24).toString('hex');
  await redis.set(
    sessionKey(token),
    JSON.stringify({ agent_id: agentId, task_id: opts.taskId ?? null }),
    { EX: ttlSeconds }
  );
  return { token, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

export async function verifySession(
  redis: RedisClient,
  token: string | undefined,
  agentId: string | undefined
): Promise<boolean> {
  if (!isAuthRequired()) return true;
  if (!token || !agentId) return false;
  const raw = await redis.get(sessionKey(token));
  if (!raw) return false;
  try {
    const data = JSON.parse(raw) as { agent_id: string };
    return data.agent_id === agentId;
  } catch {
    return false;
  }
}

export async function revokeSession(redis: RedisClient, token: string): Promise<void> {
  await redis.del(sessionKey(token));
}
