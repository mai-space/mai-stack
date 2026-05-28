import { z } from 'zod';

const MEMORY_MCP_URL = process.env.MEMORY_MCP_URL ?? 'http://mai-memory-mcp:3458';

async function memGet(path: string): Promise<unknown> {
  const res = await fetch(`${MEMORY_MCP_URL}${path}`);
  return res.json();
}

async function memPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${MEMORY_MCP_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function memDelete(path: string): Promise<unknown> {
  const res = await fetch(`${MEMORY_MCP_URL}${path}`, { method: 'DELETE' });
  if (res.status === 204) return { deleted: true };
  return res.json();
}

export function registerMemoryTools(server: any): void {
  server.tool(
    'remember',
    { project_id: z.string(), key: z.string(), value: z.string() },
    async ({ project_id, key, value }: { project_id: string; key: string; value: string }) => {
      const result = await memPost(`/projects/${project_id}/memories`, { key, value });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'recall',
    { project_id: z.string(), query: z.string(), limit: z.number().int().optional().default(10) },
    async ({ project_id, query, limit }: { project_id: string; query: string; limit: number }) => {
      const result = await memGet(`/projects/${project_id}/memories/recall?q=${encodeURIComponent(query)}&limit=${limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'forget',
    { project_id: z.string(), key: z.string() },
    async ({ project_id, key }: { project_id: string; key: string }) => {
      const result = await memDelete(`/projects/${project_id}/memories/${encodeURIComponent(key)}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'list_memories',
    { project_id: z.string(), limit: z.number().int().optional().default(50) },
    async ({ project_id, limit }: { project_id: string; limit: number }) => {
      const result = await memGet(`/projects/${project_id}/memories?limit=${limit}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    }
  );
}
