import type { QdrantClient } from '@qdrant/js-client-rest';
import { chunkWorkspace } from './chunker.js';
import { createEmbedder } from './embeddings/index.js';
import { ensureCollection, upsertChunks, collectionName } from './qdrant.js';
import { updateIndexStatus } from './registry.js';
import * as crypto from 'crypto';

const BATCH_SIZE = 20;

const activeJobs = new Map<string, 'running' | 'done' | 'error'>();

export function getJobStatus(projectId: string): string {
  return activeJobs.get(projectId) ?? 'idle';
}

function chunkId(projectId: string, filePath: string, lineStart: number): string {
  return crypto.createHash('md5').update(`${projectId}:${filePath}:${lineStart}`).digest('hex');
}

export async function indexProject(
  qdrant: QdrantClient,
  registryUrl: string,
  projectId: string,
  workspacePath: string,
  embeddingModel: string
): Promise<void> {
  activeJobs.set(projectId, 'running');
  try {
    const embedder = await createEmbedder(embeddingModel);
    await ensureCollection(qdrant, projectId, embedder.dimension);

    const chunks = chunkWorkspace(workspacePath);
    console.log(`[indexer] ${projectId}: ${chunks.length} chunks from ${workspacePath}`);

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedder.embed(batch.map((c) => c.content));
      const points = batch.map((chunk, j) => ({
        id: chunkId(projectId, chunk.file_path, chunk.line_start),
        vector: vectors[j],
        payload: { file_path: chunk.file_path, line_start: chunk.line_start, line_end: chunk.line_end, content: chunk.content },
      }));
      await upsertChunks(qdrant, projectId, points);
    }

    const now = new Date().toISOString();
    await updateIndexStatus(registryUrl, projectId, now, 'healthy');
    activeJobs.set(projectId, 'done');
    console.log(`[indexer] ${projectId}: index complete`);
  } catch (err) {
    console.error(`[indexer] ${projectId}: failed`, err);
    await updateIndexStatus(registryUrl, projectId, new Date().toISOString(), 'error');
    activeJobs.set(projectId, 'error');
  }
}
