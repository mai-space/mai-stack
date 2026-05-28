import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { getQdrantClient } from './qdrant.js';
import { syncWithRegistry } from './registrySync.js';
import { createMcpServer } from './mcp/server.js';
import { registerMcpTransport } from './mcp/transport.js';
import { fetchProject } from './registry.js';
import { indexProject, getJobStatus } from './indexer.js';
import { createEmbedder } from './embeddings/index.js';
import { searchChunks } from './qdrant.js';

const PORT = parseInt(process.env.PORT ?? '3457', 10);
const REGISTRY_URL = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';

async function main() {
  const qdrant = getQdrantClient();

  await syncWithRegistry(REGISTRY_URL, qdrant);

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors);

  app.get('/health', async () => ({ status: 'ok', service: 'mai-code-mcp', uptime: Math.floor(process.uptime()) }));

  app.post('/reindex/:projectId', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await fetchProject(REGISTRY_URL, projectId);
    if (!project) return reply.status(404).send({ error: 'Project not found in registry' });

    indexProject(qdrant, REGISTRY_URL, projectId, project.workspace_path, project.embedding_model).catch(console.error);
    return reply.status(202).send({ status: 'accepted', project_id: projectId });
  });

  app.get('/reindex/:projectId/status', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    return { project_id: projectId, status: getJobStatus(projectId) };
  });

  app.post('/search/:projectId', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const body = z.object({
      query: z.string(),
      top_k: z.number().int().min(1).max(20).optional(),
    }).parse(req.body);
    const project = await fetchProject(REGISTRY_URL, projectId);
    if (!project) return reply.status(404).send({ error: 'Project not found in registry' });
    const embedder = await createEmbedder(project.embedding_model);
    const [vector] = await embedder.embed([body.query]);
    return searchChunks(qdrant, projectId, vector, body.top_k ?? 5);
  });

  const mcpServer = createMcpServer(qdrant);
  registerMcpTransport(app, mcpServer);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-code-mcp listening on port ${PORT}`);

  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
