import { createClient } from 'redis';
import type { AgentProfile } from './config.js';

type RedisClient = ReturnType<typeof createClient>;

export type AgentState = 'IDLE' | 'WORKING' | 'BACKING_OFF' | 'GRACEFUL_SHUTDOWN' | 'HARD_PAUSE';

const STATE_TTL = 48 * 3600;
const CONCURRENCY_TTL = 3600; // 1h safety-net so abandoned claims don't leak forever

function dateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function minuteStr(): string {
  return new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

export function budgetKey(agentId: string): string {
  return `budget:${agentId}:${dateStr()}`;
}

export function providerKey(provider: string): string {
  return `budget:${provider}:${dateStr()}`;
}

function stateKey(agentId: string): string {
  return `agent:${agentId}:state`;
}

function concurrencyKey(agentId: string): string {
  return `agent:${agentId}:active_tasks`;
}

function rateLimitKey(agentId: string): string {
  return `ratelimit:${agentId}:${minuteStr()}`;
}

export async function getAgentState(redis: RedisClient, agentId: string): Promise<AgentState> {
  const val = await redis.get(stateKey(agentId));
  return (val as AgentState | null) ?? 'IDLE';
}

export async function setAgentState(redis: RedisClient, agentId: string, state: AgentState): Promise<void> {
  await redis.set(stateKey(agentId), state, { EX: STATE_TTL });
}

export interface GovernanceResult {
  allowed: boolean;
  reason?: 'not_in_allowed_agents' | 'budget_exhausted' | 'graceful_shutdown' | 'concurrency_limit' | 'rate_limited';
  retry_after?: number;
  state?: AgentState;
}

export async function checkGovernance(
  redis: RedisClient,
  agentId: string,
  profile: AgentProfile,
  allowedAgentIds: string[]
): Promise<GovernanceResult> {
  // 1. Allowed agents check
  if (allowedAgentIds.length > 0 && !allowedAgentIds.includes(agentId)) {
    return { allowed: false, reason: 'not_in_allowed_agents' };
  }

  // 2. State check (short-circuit if already paused)
  const state = await getAgentState(redis, agentId);
  if (state === 'HARD_PAUSE') {
    return { allowed: false, reason: 'budget_exhausted', state };
  }
  if (state === 'GRACEFUL_SHUTDOWN') {
    return { allowed: false, reason: 'graceful_shutdown', state };
  }

  // 3. Budget check
  if (profile.budget?.daily_usd) {
    const spent = parseFloat(await redis.get(budgetKey(agentId)) ?? '0');
    const pct = spent / profile.budget.daily_usd;
    if (pct >= 1.0) {
      await setAgentState(redis, agentId, 'HARD_PAUSE');
      return { allowed: false, reason: 'budget_exhausted', state: 'HARD_PAUSE' };
    }
    if (pct >= 0.9) {
      await setAgentState(redis, agentId, 'GRACEFUL_SHUTDOWN');
      return { allowed: false, reason: 'graceful_shutdown', state: 'GRACEFUL_SHUTDOWN' };
    }
  }

  // 4. Concurrency check
  const active = parseInt(await redis.get(concurrencyKey(agentId)) ?? '0', 10);
  if (active >= profile.max_concurrent_tasks) {
    return { allowed: false, reason: 'concurrency_limit' };
  }

  // 5. Rate limit check (fixed window per minute)
  if (profile.rate_limit?.requests_per_minute) {
    const key = rateLimitKey(agentId);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 120); // 2 min to cover clock boundary
    if (count > profile.rate_limit.requests_per_minute) {
      return { allowed: false, reason: 'rate_limited', retry_after: 60 };
    }
  }

  return { allowed: true };
}

export async function recordClaim(
  redis: RedisClient,
  agentId: string,
  profile: AgentProfile
): Promise<void> {
  if (profile.budget?.per_task_usd) {
    const cost = profile.budget.per_task_usd;
    await redis.incrByFloat(budgetKey(agentId), cost);
    await redis.expire(budgetKey(agentId), STATE_TTL);
    await redis.incrByFloat(providerKey(profile.model_provider), cost);
    await redis.expire(providerKey(profile.model_provider), STATE_TTL);
  }
  await redis.incr(concurrencyKey(agentId));
  // Safety-net TTL (refreshed on each claim): if an agent abandons a claim
  // without calling complete_task (crash, lease expiry), the counter would
  // otherwise leak forever and permanently block the agent. Self-heals once
  // the agent goes idle for CONCURRENCY_TTL.
  await redis.expire(concurrencyKey(agentId), CONCURRENCY_TTL);
  await setAgentState(redis, agentId, 'WORKING');
}

export async function recordComplete(
  redis: RedisClient,
  agentId: string
): Promise<void> {
  const active = parseInt(await redis.get(concurrencyKey(agentId)) ?? '0', 10);
  if (active > 0) await redis.decr(concurrencyKey(agentId));

  const state = await getAgentState(redis, agentId);
  if (state === 'WORKING' || state === 'BACKING_OFF') {
    await setAgentState(redis, agentId, 'IDLE');
  }
  // GRACEFUL_SHUTDOWN and HARD_PAUSE persist until Redis TTL expires (midnight reset)
}

export interface BudgetStatus {
  agent_id: string;
  state: AgentState;
  daily_usd: number;
  spent_usd: number;
  pct: number;
  active_tasks: number;
  provider: string;
  provider_spent_usd: number;
}

export async function getBudgetStatus(
  redis: RedisClient,
  profile: AgentProfile
): Promise<BudgetStatus> {
  const [spentRaw, stateRaw, activeRaw, providerSpentRaw] = await Promise.all([
    redis.get(budgetKey(profile.id)),
    redis.get(stateKey(profile.id)),
    redis.get(concurrencyKey(profile.id)),
    redis.get(providerKey(profile.model_provider)),
  ]);

  const dailyUsd = profile.budget?.daily_usd ?? 0;
  const spentUsd = parseFloat(spentRaw ?? '0');

  return {
    agent_id: profile.id,
    state: (stateRaw as AgentState | null) ?? 'IDLE',
    daily_usd: dailyUsd,
    spent_usd: spentUsd,
    pct: dailyUsd > 0 ? spentUsd / dailyUsd : 0,
    active_tasks: parseInt(activeRaw ?? '0', 10),
    provider: profile.model_provider,
    provider_spent_usd: parseFloat(providerSpentRaw ?? '0'),
  };
}
