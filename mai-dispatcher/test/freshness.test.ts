import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeRedis } from './fakeRedis.js';
import { checkFreshness } from '../src/freshness.js';

const REGISTRY_URL = 'http://registry';
const CODE_MCP_URL = 'http://code-mcp';

describe('checkFreshness', () => {
  let redis: ReturnType<typeof createFakeRedis>;

  beforeEach(() => {
    redis = createFakeRedis();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips the check entirely when the project is not marked dirty', async () => {
    global.fetch = vi.fn();
    const result = await checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 5000);
    expect(result).toEqual({ staleWarning: null });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips the check when the project is not found in the registry', async () => {
    await redis.set('project:app-a:dirty', '1');
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 5000);
    expect(result).toEqual({ staleWarning: null });
  });

  it('clears the dirty flag without reindexing when the index is still fresh enough', async () => {
    await redis.set('project:app-a:dirty', '1');
    const recentTimestamp = new Date(Date.now() - 2 * 60_000).toISOString(); // 2 minutes ago
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ last_indexed_at: recentTimestamp, reindex_threshold_minutes: 15 }),
    });

    const result = await checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 5000);
    expect(result).toEqual({ staleWarning: null });
    expect(await redis.get('project:app-a:dirty')).toBe('0');
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the registry lookup, no reindex call
  });

  it('triggers a reindex and clears dirty once the job reports done', async () => {
    vi.useFakeTimers();
    await redis.set('project:app-a:dirty', '1');
    const staleTimestamp = new Date(Date.now() - 60 * 60_000).toISOString(); // 1 hour ago

    let statusCalls = 0;
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/projects/app-a')) {
        return { ok: true, json: async () => ({ last_indexed_at: staleTimestamp, reindex_threshold_minutes: 15 }) };
      }
      if (u.endsWith('/reindex/app-a') ) {
        return { ok: true, json: async () => ({}) };
      }
      if (u.endsWith('/reindex/app-a/status')) {
        statusCalls++;
        return { ok: true, json: async () => ({ status: statusCalls < 2 ? 'running' : 'done' }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as any;

    const promise = checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 30_000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result).toEqual({ staleWarning: null });
    expect(await redis.get('project:app-a:dirty')).toBe('0');
    expect(statusCalls).toBeGreaterThanOrEqual(2);
  });

  it('treats a project that was never indexed as stale and triggers a reindex', async () => {
    vi.useFakeTimers();
    await redis.set('project:app-a:dirty', '1');

    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/projects/app-a')) {
        return { ok: true, json: async () => ({ last_indexed_at: null, reindex_threshold_minutes: 15 }) };
      }
      if (u.endsWith('/reindex/app-a')) return { ok: true, json: async () => ({}) };
      if (u.endsWith('/reindex/app-a/status')) return { ok: true, json: async () => ({ status: 'done' }) };
      throw new Error(`unexpected fetch: ${u}`);
    }) as any;

    const promise = checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 30_000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual({ staleWarning: null });
  });

  it('warns without throwing when triggering the reindex fails outright', async () => {
    await redis.set('project:app-a:dirty', '1');
    const staleTimestamp = new Date(Date.now() - 60 * 60_000).toISOString();

    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/projects/app-a')) {
        return { ok: true, json: async () => ({ last_indexed_at: staleTimestamp, reindex_threshold_minutes: 15 }) };
      }
      if (u.endsWith('/reindex/app-a')) return { ok: false, status: 500 };
      throw new Error(`unexpected fetch: ${u}`);
    }) as any;

    const result = await checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 5000);
    expect(result.staleWarning).toContain('Reindex trigger failed');
  });

  it('warns when mai-code-mcp cannot be reached at all', async () => {
    await redis.set('project:app-a:dirty', '1');
    const staleTimestamp = new Date(Date.now() - 60 * 60_000).toISOString();

    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/projects/app-a')) {
        return { ok: true, json: async () => ({ last_indexed_at: staleTimestamp, reindex_threshold_minutes: 15 }) };
      }
      throw new Error('connection refused');
    }) as any;

    const result = await checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 5000);
    expect(result.staleWarning).toContain('Could not reach mai-code-mcp');
  });

  it('warns after the reindex poll times out', async () => {
    vi.useFakeTimers();
    await redis.set('project:app-a:dirty', '1');
    const staleTimestamp = new Date(Date.now() - 60 * 60_000).toISOString();

    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/projects/app-a')) {
        return { ok: true, json: async () => ({ last_indexed_at: staleTimestamp, reindex_threshold_minutes: 15 }) };
      }
      if (u.endsWith('/reindex/app-a')) return { ok: true, json: async () => ({}) };
      if (u.endsWith('/reindex/app-a/status')) return { ok: true, json: async () => ({ status: 'running' }) }; // never finishes
      throw new Error(`unexpected fetch: ${u}`);
    }) as any;

    const promise = checkFreshness(redis as any, 'app-a', REGISTRY_URL, CODE_MCP_URL, 3000);
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;
    expect(result.staleWarning).toContain('timed out');
  });
});
