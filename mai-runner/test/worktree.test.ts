import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectConfigSchema } from '../src/config.js';

// RUNNER_MAX_GLOBAL_WORKTREES is read once at module load — set before the dynamic import.
process.env.RUNNER_MAX_GLOBAL_WORKTREES = '3';
const { tryAcquireSlot, releaseSlot } = await import('../src/worktree.js');

function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> { return store.has(key) ? store.get(key)! : null; },
    async incr(key: string): Promise<number> {
      const v = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(v));
      return v;
    },
    async decr(key: string): Promise<number> {
      const v = parseInt(store.get(key) ?? '0', 10) - 1;
      store.set(key, String(v));
      return v;
    },
    async set(key: string, value: string): Promise<void> { store.set(key, value); },
  };
}

function project(overrides: Partial<{ id: string; max_parallel_worktrees: number }> = {}) {
  return ProjectConfigSchema.parse({
    id: overrides.id ?? 'app-a',
    workspace: '/workspaces/app-a',
    runtime: { type: 'ddev', max_parallel_worktrees: overrides.max_parallel_worktrees ?? 5 },
  });
}

describe('tryAcquireSlot / releaseSlot', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  beforeEach(() => { redis = createFakeRedis(); });

  it('grants a slot when under every cap', async () => {
    expect(await tryAcquireSlot(redis as any, project(), 5)).toBe(true);
  });

  it('is capped by the agent profile\'s own max_parallel_worktrees', async () => {
    const p = project({ max_parallel_worktrees: 10 });
    expect(await tryAcquireSlot(redis as any, p, 1)).toBe(true);
    expect(await tryAcquireSlot(redis as any, p, 1)).toBe(false); // agent cap of 1 already used
  });

  it('is capped by the project\'s own runtime.max_parallel_worktrees', async () => {
    const p = project({ max_parallel_worktrees: 1 });
    expect(await tryAcquireSlot(redis as any, p, 10)).toBe(true);
    expect(await tryAcquireSlot(redis as any, p, 10)).toBe(false); // project cap of 1 already used
  });

  it('is capped globally by RUNNER_MAX_GLOBAL_WORKTREES across different projects', async () => {
    // RUNNER_MAX_GLOBAL_WORKTREES=3 (set above); each project individually allows plenty
    const a = project({ id: 'app-a', max_parallel_worktrees: 10 });
    const b = project({ id: 'app-b', max_parallel_worktrees: 10 });
    expect(await tryAcquireSlot(redis as any, a, 10)).toBe(true);
    expect(await tryAcquireSlot(redis as any, a, 10)).toBe(true);
    expect(await tryAcquireSlot(redis as any, b, 10)).toBe(true);
    expect(await tryAcquireSlot(redis as any, b, 10)).toBe(false); // 4th globally, cap is 3
  });

  it('releaseSlot frees both the project and global counters for another acquire', async () => {
    const p = project({ max_parallel_worktrees: 1 });
    expect(await tryAcquireSlot(redis as any, p, 10)).toBe(true);
    expect(await tryAcquireSlot(redis as any, p, 10)).toBe(false);

    await releaseSlot(redis as any, p);
    expect(await tryAcquireSlot(redis as any, p, 10)).toBe(true);
  });

  it('releaseSlot never takes a counter below zero', async () => {
    const p = project();
    await releaseSlot(redis as any, p);
    await releaseSlot(redis as any, p);
    expect(await redis.get('runner:global:worktrees')).toBe('0');
    expect(await redis.get(`runner:${p.id}:worktrees`)).toBe('0');
  });
});
