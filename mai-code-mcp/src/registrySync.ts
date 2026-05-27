import type { QdrantClient } from '@qdrant/js-client-rest';
import { fetchProjects } from './registry.js';
import { ensureCollection } from './qdrant.js';
import { vectorDimFor } from './embeddings/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncWithRegistry(registryUrl: string, qdrant: QdrantClient): Promise<void> {
  const delays = [2000, 4000, 8000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const projects = await fetchProjects(registryUrl);
      for (const p of projects) {
        const dim = vectorDimFor(p.embedding_model);
        await ensureCollection(qdrant, p.id, dim);
      }
      console.log(`[registrySync] Synced ${projects.length} project(s) from registry`);
      return;
    } catch (err) {
      if (attempt === delays.length) {
        console.warn('[registrySync] Failed after retries, continuing without sync:', String(err));
        return;
      }
      console.warn(`[registrySync] Attempt ${attempt + 1} failed, retrying in ${delays[attempt]}ms...`);
      await sleep(delays[attempt]);
    }
  }
}
