import type { FastifyInstance } from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from 'redis';
import { verifySession } from '../auth.js';

type RedisClient = ReturnType<typeof createClient>;

function extractCreds(request: { headers: Record<string, unknown>; query: unknown }): { agentId?: string; token?: string } {
  const headers = request.headers;
  const query = (request.query ?? {}) as Record<string, string | undefined>;
  const agentId = (headers['x-agent-id'] as string | undefined) ?? query.agent_id;
  const token = (headers['x-session-token'] as string | undefined) ?? query.token;
  return { agentId, token };
}

export function registerMcpTransport(app: FastifyInstance, server: McpServer, redis: RedisClient): void {
  const transports = new Map<string, SSEServerTransport>();
  // sessionId -> the mai-stack agent session that opened it, so /messages can re-check auth
  const owners = new Map<string, { agentId?: string; token?: string }>();

  app.get('/sse', async (request, reply) => {
    const creds = extractCreds(request as any);
    if (!(await verifySession(redis, creds.token, creds.agentId))) {
      return reply.status(401).send({ error: 'Unauthorized — missing or invalid X-Agent-Id/X-Session-Token' });
    }

    const transport = new SSEServerTransport('/messages', reply.raw);
    transports.set(transport.sessionId, transport);
    owners.set(transport.sessionId, creds);

    reply.raw.on('close', () => {
      transports.delete(transport.sessionId);
      owners.delete(transport.sessionId);
    });

    await server.connect(transport);

    await new Promise<void>((resolve) => {
      reply.raw.on('close', resolve);
    });
  });

  app.post('/messages', async (request, reply) => {
    const { sessionId } = request.query as { sessionId?: string };
    const transport = transports.get(sessionId ?? '');
    if (!transport) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    const owner = owners.get(sessionId ?? '');
    if (!(await verifySession(redis, owner?.token, owner?.agentId))) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    await transport.handlePostMessage(request.raw, reply.raw, request.body);
  });
}
