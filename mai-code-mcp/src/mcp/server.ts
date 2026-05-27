import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { createEmbedder } from '../embeddings/index.js';
import { searchChunks } from '../qdrant.js';
import { fetchProjects, fetchProject } from '../registry.js';
import { indexProject, getJobStatus } from '../indexer.js';

export function createMcpServer(qdrant: QdrantClient): McpServer {
  const registryUrl = process.env.REGISTRY_URL ?? 'http://mai-registry:3459';
  const server = new McpServer({ name: 'mai-code-mcp', version: '1.0.0' });

  server.tool(
    'search_code',
    {
      project_id: z.string().describe('Project ID to search in'),
      query: z.string().describe('Natural language search query'),
      top_k: z.number().int().min(1).max(20).optional().describe('Number of results (default 5)'),
    },
    async ({ project_id, query, top_k = 5 }: { project_id: string; query: string; top_k?: number }) => {
      const project = await fetchProject(registryUrl, project_id);
      if (!project) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not found' }) }] };

      const embedder = await createEmbedder(project.embedding_model);
      const [vector] = await embedder.embed([query]);
      const results = await searchChunks(qdrant, project_id, vector, top_k);
      return { content: [{ type: 'text' as const, text: JSON.stringify(results) }] };
    }
  );

  server.tool(
    'reindex_project',
    {
      project_id: z.string().describe('Project ID to reindex'),
      incremental: z.boolean().optional().describe('Incremental reindex (default true)'),
    },
    async ({ project_id }: { project_id: string }) => {
      const project = await fetchProject(registryUrl, project_id);
      if (!project) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Project not found' }) }] };

      const workspacePath = `/workspaces/${project.id}`;
      indexProject(qdrant, registryUrl, project_id, workspacePath, project.embedding_model).catch(console.error);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'accepted', project_id }) }] };
    }
  );

  server.tool(
    'list_indexed_projects',
    {},
    async () => {
      const projects = await fetchProjects(registryUrl);
      return { content: [{ type: 'text' as const, text: JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name, index_health: p.index_health, last_indexed_at: p.last_indexed_at }))) }] };
    }
  );

  return server;
}
