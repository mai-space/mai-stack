import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeRedis } from './fakeRedis.js';
import { rememberEntry, listMemories, recallMemories, forgetMemory } from '../src/redis.js';

/** Memories are ordered by Date.now() score, so calls in the same millisecond would tie — advance the clock between them. */
async function rememberAt(redis: unknown, projectId: string, key: string, value: string) {
  const result = await rememberEntry(redis as any, projectId, key, value);
  vi.advanceTimersByTime(1);
  return result;
}

describe('rememberEntry', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  beforeEach(() => { redis = createFakeRedis(); });

  it('creates a new memory the first time a key is used', async () => {
    const result = await rememberEntry(redis as any, 'app-a', 'rate-limiter-choice', 'rate-limiter-flexible');
    expect(result.created).toBe(true);
    expect(result.key).toBe('rate-limiter-choice');
    expect(result.value).toBe('rate-limiter-flexible');
    expect(result.id).toBeTruthy();
  });

  it('updates the existing memory in place when the same key is remembered again', async () => {
    const first = await rememberEntry(redis as any, 'app-a', 'rate-limiter-choice', 'v1');
    const second = await rememberEntry(redis as any, 'app-a', 'rate-limiter-choice', 'v2');

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id); // same underlying memory, not a duplicate
    expect(second.value).toBe('v2');

    const all = await listMemories(redis as any, 'app-a');
    expect(all).toHaveLength(1);
    expect(all[0].value).toBe('v2');
  });

  it('keeps memories scoped per project', async () => {
    await rememberEntry(redis as any, 'app-a', 'k', 'a-value');
    await rememberEntry(redis as any, 'app-b', 'k', 'b-value');
    expect(await listMemories(redis as any, 'app-a')).toHaveLength(1);
    expect(await listMemories(redis as any, 'app-b')).toHaveLength(1);
  });
});

describe('listMemories', () => {
  it('returns memories most-recent-first, respecting the limit', async () => {
    vi.useFakeTimers();
    const redis = createFakeRedis();
    await rememberAt(redis, 'app-a', 'first', 'v1');
    await rememberAt(redis, 'app-a', 'second', 'v2');
    await rememberAt(redis, 'app-a', 'third', 'v3');
    vi.useRealTimers();

    const all = await listMemories(redis as any, 'app-a', 500);
    expect(all.map(m => m.key)).toEqual(['third', 'second', 'first']);

    const limited = await listMemories(redis as any, 'app-a', 2);
    expect(limited).toHaveLength(2);
    expect(limited.map(m => m.key)).toEqual(['third', 'second']);
  });
});

describe('recallMemories', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  beforeEach(async () => {
    redis = createFakeRedis();
    vi.useFakeTimers();
    await rememberAt(redis, 'app-a', 'rate-limiter-choice', 'Decided to use Upstash Redis for rate limiting');
    await rememberAt(redis, 'app-a', 'auth-approach', 'Using JWT with refresh tokens');
    await rememberAt(redis, 'app-a', 'db-choice', 'Postgres with Kysely as the query builder');
    vi.useRealTimers();
  });

  it('ranks memories by how many query terms match key+value', async () => {
    const results = await recallMemories(redis as any, 'app-a', 'rate limiting redis', 10);
    expect(results[0].key).toBe('rate-limiter-choice');
  });

  it('excludes memories with zero matching terms', async () => {
    const results = await recallMemories(redis as any, 'app-a', 'rate limiting redis', 10);
    expect(results.map(r => r.key)).not.toContain('auth-approach');
    expect(results.map(r => r.key)).not.toContain('db-choice');
  });

  it('falls back to most-recent-first when the query is empty', async () => {
    const results = await recallMemories(redis as any, 'app-a', '', 2);
    expect(results).toHaveLength(2);
    expect(results.map(r => r.key)).toEqual(['db-choice', 'auth-approach']);
  });

  it('respects the limit', async () => {
    const results = await recallMemories(redis as any, 'app-a', 'redis postgres jwt', 1);
    expect(results).toHaveLength(1);
  });
});

describe('forgetMemory', () => {
  it('deletes an existing memory and returns true', async () => {
    const redis = createFakeRedis();
    await rememberEntry(redis as any, 'app-a', 'k', 'v');
    const deleted = await forgetMemory(redis as any, 'app-a', 'k');
    expect(deleted).toBe(true);
    expect(await listMemories(redis as any, 'app-a')).toHaveLength(0);
  });

  it('returns false for a key that does not exist', async () => {
    const redis = createFakeRedis();
    const deleted = await forgetMemory(redis as any, 'app-a', 'missing');
    expect(deleted).toBe(false);
  });
});
