import { describe, it, expect, vi } from 'vitest';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { collectionName, ensureCollection, upsertChunks, searchChunks } from '../src/qdrant.js';

function fakeClient(overrides: Partial<Record<'getCollection' | 'createCollection' | 'upsert' | 'search', any>> = {}) {
  return {
    getCollection: vi.fn().mockResolvedValue({}),
    createCollection: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as QdrantClient;
}

describe('collectionName', () => {
  it('namespaces by project id', () => {
    expect(collectionName('app-a')).toBe('project_app-a');
  });
});

describe('ensureCollection', () => {
  it('does nothing when the collection already exists', async () => {
    const client = fakeClient();
    await ensureCollection(client, 'app-a', 768);
    expect((client as any).createCollection).not.toHaveBeenCalled();
  });

  it('creates the collection with the given vector size when it does not exist', async () => {
    const client = fakeClient({ getCollection: vi.fn().mockRejectedValue(new Error('not found')) });
    await ensureCollection(client, 'app-a', 1536);
    expect((client as any).createCollection).toHaveBeenCalledWith('project_app-a', {
      vectors: { size: 1536, distance: 'Cosine' },
    });
  });
});

describe('upsertChunks', () => {
  it('upserts points into the project-namespaced collection', async () => {
    const client = fakeClient();
    const points = [{ id: 'a', vector: [0.1, 0.2], payload: { file_path: 'x.ts' } }];
    await upsertChunks(client, 'app-a', points);
    expect((client as any).upsert).toHaveBeenCalledWith('project_app-a', {
      wait: true,
      points: [{ id: 'a', vector: [0.1, 0.2], payload: { file_path: 'x.ts' } }],
    });
  });
});

describe('searchChunks', () => {
  it('maps qdrant results to the search result shape', async () => {
    const client = fakeClient({
      search: vi.fn().mockResolvedValue([
        { score: 0.94, payload: { file_path: 'app.ts', line_start: 10, content: 'const x = 1;' } },
      ]),
    });
    const results = await searchChunks(client, 'app-a', [0.1], 5);
    expect(results).toEqual([{ file_path: 'app.ts', line_start: 10, content: 'const x = 1;', similarity_score: 0.94 }]);
  });

  it('returns an empty array when the collection search fails (e.g. not yet indexed)', async () => {
    const client = fakeClient({ search: vi.fn().mockRejectedValue(new Error('collection not found')) });
    const results = await searchChunks(client, 'app-a', [0.1], 5);
    expect(results).toEqual([]);
  });

  it('defaults missing payload fields safely', async () => {
    const client = fakeClient({ search: vi.fn().mockResolvedValue([{ score: 0.5, payload: undefined }]) });
    const results = await searchChunks(client, 'app-a', [0.1], 5);
    expect(results).toEqual([{ file_path: '', line_start: 0, content: '', similarity_score: 0.5 }]);
  });
});
