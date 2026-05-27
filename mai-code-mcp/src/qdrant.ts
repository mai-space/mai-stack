import { QdrantClient } from '@qdrant/js-client-rest';

let _client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!_client) {
    const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
    _client = new QdrantClient({ url });
  }
  return _client;
}

export function collectionName(projectId: string): string {
  return `project_${projectId}`;
}

export async function ensureCollection(client: QdrantClient, projectId: string, vectorSize: number): Promise<void> {
  const name = collectionName(projectId);
  try {
    await client.getCollection(name);
  } catch {
    await client.createCollection(name, {
      vectors: { size: vectorSize, distance: 'Cosine' },
    });
    console.log(`[qdrant] Created collection: ${name}`);
  }
}

export async function upsertChunks(
  client: QdrantClient,
  projectId: string,
  points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>
): Promise<void> {
  const name = collectionName(projectId);
  await client.upsert(name, {
    wait: true,
    points: points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload,
    })),
  });
}

export async function searchChunks(
  client: QdrantClient,
  projectId: string,
  vector: number[],
  topK: number
): Promise<Array<{ file_path: string; line_start: number; content: string; similarity_score: number }>> {
  const name = collectionName(projectId);
  try {
    const results = await client.search(name, { vector, limit: topK, with_payload: true });
    return results.map((r) => ({
      file_path: (r.payload?.file_path as string) ?? '',
      line_start: (r.payload?.line_start as number) ?? 0,
      content: (r.payload?.content as string) ?? '',
      similarity_score: r.score,
    }));
  } catch {
    return [];
  }
}
