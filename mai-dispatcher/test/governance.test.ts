import { describe, it, expect, beforeEach } from 'vitest';
import { createFakeRedis } from './fakeRedis.js';
import { checkGovernance, recordClaim, recordComplete, getBudgetStatus, getAgentState, setAgentState, budgetKey, providerKey } from '../src/governance.js';
import type { AgentProfile } from '../src/config.js';

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-1',
    type: 'cursor',
    model_provider: 'anthropic',
    model: 'claude-sonnet-5',
    task_types: ['code'],
    max_concurrent_tasks: 2,
    budget: { daily_usd: 5, per_task_usd: 1 },
    rate_limit: { requests_per_minute: 3 },
    ...overrides,
  } as AgentProfile;
}

describe('checkGovernance', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  beforeEach(() => { redis = createFakeRedis(); });

  it('allows a well-behaved agent within budget, concurrency, and rate limits', async () => {
    const result = await checkGovernance(redis as any, 'agent-1', profile(), []);
    expect(result.allowed).toBe(true);
  });

  it('rejects an agent not in the project allowed_agent_ids list', async () => {
    const result = await checkGovernance(redis as any, 'agent-1', profile(), ['agent-2']);
    expect(result).toEqual({ allowed: false, reason: 'not_in_allowed_agents' });
  });

  it('allows any agent when allowed_agent_ids is empty (unrestricted)', async () => {
    const result = await checkGovernance(redis as any, 'agent-1', profile(), []);
    expect(result.allowed).toBe(true);
  });

  it('short-circuits on an existing HARD_PAUSE state', async () => {
    await setAgentState(redis as any, 'agent-1', 'HARD_PAUSE');
    const result = await checkGovernance(redis as any, 'agent-1', profile(), []);
    expect(result).toEqual({ allowed: false, reason: 'budget_exhausted', state: 'HARD_PAUSE' });
  });

  it('short-circuits on an existing GRACEFUL_SHUTDOWN state', async () => {
    await setAgentState(redis as any, 'agent-1', 'GRACEFUL_SHUTDOWN');
    const result = await checkGovernance(redis as any, 'agent-1', profile(), []);
    expect(result).toEqual({ allowed: false, reason: 'graceful_shutdown', state: 'GRACEFUL_SHUTDOWN' });
  });

  it('hard-pauses and rejects once spend reaches 100% of the daily budget', async () => {
    await redis.set(budgetKey('agent-1'), '5');
    const result = await checkGovernance(redis as any, 'agent-1', profile({ budget: { daily_usd: 5 } }), []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('budget_exhausted');
    expect(await getAgentState(redis as any, 'agent-1')).toBe('HARD_PAUSE');
  });

  it('moves to graceful shutdown once spend reaches 90% of the daily budget', async () => {
    await redis.set(budgetKey('agent-1'), '4.5');
    const result = await checkGovernance(redis as any, 'agent-1', profile({ budget: { daily_usd: 5 } }), []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('graceful_shutdown');
    expect(await getAgentState(redis as any, 'agent-1')).toBe('GRACEFUL_SHUTDOWN');
  });

  it('rejects once active tasks reach max_concurrent_tasks', async () => {
    await redis.set('agent:agent-1:active_tasks', '2');
    const result = await checkGovernance(redis as any, 'agent-1', profile({ max_concurrent_tasks: 2 }), []);
    expect(result).toEqual({ allowed: false, reason: 'concurrency_limit' });
  });

  it('rate-limits once requests_per_minute is exceeded, with a 60s retry hint', async () => {
    const p = profile({ rate_limit: { requests_per_minute: 2 } });
    await checkGovernance(redis as any, 'agent-1', p, []);
    await checkGovernance(redis as any, 'agent-1', p, []);
    const third = await checkGovernance(redis as any, 'agent-1', p, []);
    expect(third).toEqual({ allowed: false, reason: 'rate_limited', retry_after: 60 });
  });
});

describe('recordClaim / recordComplete', () => {
  it('recordClaim charges per_task_usd to both the agent and provider buckets, and marks WORKING', async () => {
    const redis = createFakeRedis();
    const p = profile({ budget: { daily_usd: 5, per_task_usd: 1.5 } });
    await recordClaim(redis as any, 'agent-1', p);

    expect(parseFloat((await redis.get(budgetKey('agent-1')))!)).toBe(1.5);
    expect(parseFloat((await redis.get(providerKey('anthropic')))!)).toBe(1.5);
    expect(await redis.get('agent:agent-1:active_tasks')).toBe('1');
    expect(await getAgentState(redis as any, 'agent-1')).toBe('WORKING');
  });

  it('recordComplete decrements concurrency and returns to IDLE from WORKING', async () => {
    const redis = createFakeRedis();
    const p = profile();
    await recordClaim(redis as any, 'agent-1', p);
    await recordComplete(redis as any, 'agent-1');

    expect(await redis.get('agent:agent-1:active_tasks')).toBe('0');
    expect(await getAgentState(redis as any, 'agent-1')).toBe('IDLE');
  });

  it('recordComplete is a no-op on concurrency when there is nothing to decrement', async () => {
    const redis = createFakeRedis();
    await recordComplete(redis as any, 'agent-1');
    // active_tasks was never set, so it must stay unset rather than being written to a
    // (misleadingly precise) '0' — this is what stops the counter from ever decrementing below zero.
    expect(await redis.get('agent:agent-1:active_tasks')).toBeNull();
  });

  it('recordComplete leaves a HARD_PAUSE state untouched', async () => {
    const redis = createFakeRedis();
    await setAgentState(redis as any, 'agent-1', 'HARD_PAUSE');
    await recordComplete(redis as any, 'agent-1');
    expect(await getAgentState(redis as any, 'agent-1')).toBe('HARD_PAUSE');
  });
});

describe('getBudgetStatus', () => {
  it('aggregates spend, pct, state, and concurrency for a profile', async () => {
    const redis = createFakeRedis();
    const p = profile({ budget: { daily_usd: 10, per_task_usd: 2 } });
    await recordClaim(redis as any, 'agent-1', p);
    await recordClaim(redis as any, 'agent-1', p);

    const status = await getBudgetStatus(redis as any, p);
    expect(status.spent_usd).toBe(4);
    expect(status.daily_usd).toBe(10);
    expect(status.pct).toBe(0.4);
    expect(status.active_tasks).toBe(2);
    expect(status.provider_spent_usd).toBe(4);
  });
});
