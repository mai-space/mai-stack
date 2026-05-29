import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { publishStateChange, type RedisClient } from '../redis.js';

export const LEASE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function leaseExpiresAt(fromMs = Date.now()): string {
  return new Date(fromMs + LEASE_TTL_MS).toISOString();
}

/** Move IN_PROGRESS tasks with expired leases back to OPEN. */
export async function expireLeases(db: Kysely<Database>, redis: RedisClient | null): Promise<number> {
  const now = new Date().toISOString();
  const expired = await db
    .selectFrom('tasks')
    .selectAll()
    .where('status', '=', 'IN_PROGRESS')
    .where('lease_expires_at', 'is not', null)
    .where('lease_expires_at', '<', now)
    .execute();

  for (const task of expired) {
    await db
      .updateTable('tasks')
      .set({ status: 'OPEN', assigned_agent: null, lease_expires_at: null, updated_at: now })
      .where('id', '=', task.id)
      .execute();
    await publishStateChange(redis, task.id, {
      task_id: task.id,
      project_id: task.project_id,
      from: 'IN_PROGRESS',
      to: 'OPEN',
      reason: 'lease_expired',
      previous_agent: task.assigned_agent,
      timestamp: now,
    });
  }

  return expired.length;
}

export function startLeaseExpirySweep(
  db: Kysely<Database>,
  redis: RedisClient | null,
  intervalMs = 60_000
): ReturnType<typeof setInterval> {
  const sweep = () => {
    expireLeases(db, redis).catch((err) => console.error('[lease] expiry sweep failed:', err));
  };
  sweep();
  return setInterval(sweep, intervalMs);
}
