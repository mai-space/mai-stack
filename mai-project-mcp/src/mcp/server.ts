import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { registerTaskTools } from './tools/task-tools.js';
import { registerBlockerTools } from './tools/blocker-tools.js';

export function createMcpServer(db: Kysely<Database>, redis: any): McpServer {
  const server = new McpServer({
    name: 'mai-project-mcp',
    version: '1.0.0',
  });

  registerTaskTools(server, db, redis);
  registerBlockerTools(server, db, redis);

  return server;
}
