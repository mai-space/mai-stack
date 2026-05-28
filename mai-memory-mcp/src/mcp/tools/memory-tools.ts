import { z } from 'zod';
import { rememberEntry, listMemories, recallMemories, forgetMemory } from '../../redis.js';
import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

export function registerMemoryTools(server: any, redis: RedisClient): void {
  server.tool(
    'remember',
    {
      project_id: z.string().describe('Project ID'),
      key: z.string().describe('Short label for this memory (e.g. "rate-limiter-choice")'),
      value: z.string().describe('The memory content'),
    },
    async ({ project_id, key, value }: { project_id: string; key: string; value: string }) => {
      const memory = await rememberEntry(redis, project_id, key, value);
      return { content: [{ type: 'text' as const, text: JSON.stringify(memory) }] };
    }
  );

  server.tool(
    'recall',
    {
      project_id: z.string().describe('Project ID'),
      query: z.string().describe('Search query'),
      limit: z.number().int().min(1).max(100).optional().default(10),
    },
    async ({ project_id, query, limit }: { project_id: string; query: string; limit: number }) => {
      const memories = await recallMemories(redis, project_id, query, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(memories) }] };
    }
  );

  server.tool(
    'forget',
    {
      project_id: z.string().describe('Project ID'),
      key: z.string().describe('Key of the memory to delete'),
    },
    async ({ project_id, key }: { project_id: string; key: string }) => {
      const deleted = await forgetMemory(redis, project_id, key);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ deleted }) }] };
    }
  );

  server.tool(
    'list_memories',
    {
      project_id: z.string().describe('Project ID'),
      limit: z.number().int().min(1).max(500).optional().default(50),
    },
    async ({ project_id, limit }: { project_id: string; limit: number }) => {
      const memories = await listMemories(redis, project_id, limit);
      return { content: [{ type: 'text' as const, text: JSON.stringify(memories) }] };
    }
  );
}
