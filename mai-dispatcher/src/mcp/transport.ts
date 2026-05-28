import type { FastifyInstance } from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerMcpTransport(app: FastifyInstance, server: McpServer): void {
  const transports = new Map<string, SSEServerTransport>();

  app.get('/sse', async (request, reply) => {
    const transport = new SSEServerTransport('/messages', reply.raw);
    transports.set(transport.sessionId, transport);

    reply.raw.on('close', () => {
      transports.delete(transport.sessionId);
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
    await transport.handlePostMessage(request.raw, reply.raw, request.body);
  });
}
