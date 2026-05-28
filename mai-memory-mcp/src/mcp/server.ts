import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from 'redis';
import { registerMemoryTools } from './tools/memory-tools.js';

type RedisClient = ReturnType<typeof createClient>;

export function createMcpServer(redis: RedisClient): McpServer {
  const server = new McpServer({ name: 'mai-memory-mcp', version: '1.0.0' });
  registerMemoryTools(server, redis);
  return server;
}
