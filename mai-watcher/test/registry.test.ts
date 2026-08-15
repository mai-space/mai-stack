import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProjects } from '../src/registry.js';

describe('fetchProjects', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns projects on a successful fetch', async () => {
    const projects = [{ id: 'a', workspace_path: '/a', embedding_model: 'ollama:nomic-embed-text' }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => projects } as any);
    await expect(fetchProjects('http://registry')).resolves.toEqual(projects);
  });

  it('retries on network failure and succeeds once the registry recovers', async () => {
    const projects = [{ id: 'a', workspace_path: '/a', embedding_model: 'x' }];
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('network error');
      return { ok: true, json: async () => projects };
    });

    const promise = fetchProjects('http://registry');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual(projects);
    expect(calls).toBe(3);
  });

  it('gives up and returns an empty array after exhausting all retries', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('registry down'));
    const promise = fetchProjects('http://registry');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('treats a non-ok HTTP response as a failure to retry', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 } as any);
    const promise = fetchProjects('http://registry');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual([]);
  });
});
