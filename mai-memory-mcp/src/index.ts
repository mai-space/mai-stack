import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getRedis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memories.js';
import { createMcpServer } from './mcp/server.js';
import { registerMcpTransport } from './mcp/transport.js';

const PORT = parseInt(process.env.PORT ?? '3458', 10);

async function main(): Promise<void> {
  const redis = await getRedis();

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors);

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await healthRoutes(app);
  await memoryRoutes(app, redis);

  const mcpServer = createMcpServer(redis);
  registerMcpTransport(app, mcpServer);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-memory-mcp listening on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    await redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: Error) => { console.error('Fatal:', err); process.exit(1); });
