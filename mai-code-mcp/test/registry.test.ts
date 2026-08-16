import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchProjects, fetchProject, updateIndexStatus } from '../src/registry.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as any;
}

describe('mai-code-mcp registry client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchProjects', () => {
    it('returns the parsed project list', async () => {
      global.fetch = vi.fn(async () => jsonResponse([{ id: 'app-a' }])) as any;
      const projects = await fetchProjects('http://mai-registry:3459');
      expect(projects).toEqual([{ id: 'app-a' }]);
    });

    it('throws when the registry responds with an error status', async () => {
      global.fetch = vi.fn(async () => jsonResponse(null, false, 500)) as any;
      await expect(fetchProjects('http://mai-registry:3459')).rejects.toThrow('Registry returned 500');
    });
  });

  describe('fetchProject', () => {
    it('returns the project when found', async () => {
      global.fetch = vi.fn(async () => jsonResponse({ id: 'app-a' })) as any;
      const project = await fetchProject('http://mai-registry:3459', 'app-a');
      expect(project).toEqual({ id: 'app-a' });
    });

    it('returns null for a 404', async () => {
      global.fetch = vi.fn(async () => jsonResponse(null, false, 404)) as any;
      const project = await fetchProject('http://mai-registry:3459', 'missing');
      expect(project).toBeNull();
    });

    it('throws for a non-404 error status', async () => {
      global.fetch = vi.fn(async () => jsonResponse(null, false, 500)) as any;
      await expect(fetchProject('http://mai-registry:3459', 'app-a')).rejects.toThrow('Registry returned 500');
    });
  });

  describe('updateIndexStatus', () => {
    it('PATCHes the index status with the given fields', async () => {
      const fetchMock = vi.fn(async () => jsonResponse({}));
      global.fetch = fetchMock as any;

      await updateIndexStatus('http://mai-registry:3459', 'app-a', '2026-01-01T00:00:00.000Z', 'healthy');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://mai-registry:3459/projects/app-a/index-status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ last_indexed_at: '2026-01-01T00:00:00.000Z', index_health: 'healthy' }),
        })
      );
    });

    it('does not throw when the registry responds with an error status', async () => {
      global.fetch = vi.fn(async () => jsonResponse(null, false, 500)) as any;
      await expect(
        updateIndexStatus('http://mai-registry:3459', 'app-a', '2026-01-01T00:00:00.000Z', 'error')
      ).resolves.toBeUndefined();
    });
  });
});
