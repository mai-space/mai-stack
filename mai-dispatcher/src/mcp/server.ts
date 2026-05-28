import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from 'redis';
import { registerTaskTools } from './tools/task-tools.js';
import { registerMemoryTools } from './tools/memory-tools.js';

type RedisClient = ReturnType<typeof createClient>;

export function createMcpServer(redis: RedisClient): McpServer {
  const server = new McpServer({ name: 'mai-dispatcher', version: '1.0.0' });
  registerTaskTools(server, redis);
  registerMemoryTools(server);
  return server;
}
