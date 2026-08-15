import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getRedis } from './redis.js';
import { loadAgentProfiles } from './config.js';
import { startScheduler } from './scheduler.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { createMcpServer } from './mcp/server.js';
import { registerMcpTransport } from './mcp/transport.js';

const PORT = parseInt(process.env.PORT ?? '3460', 10);
const CONFIG_PATH = process.env.CONFIG_PATH ?? '/config/agents.yml';

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) {
    console.error('[startup] REDIS_URL is required');
    process.exit(1);
  }

  const redis = await getRedis();
  loadAgentProfiles(CONFIG_PATH);
  startScheduler(redis);

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors);

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await healthRoutes(app);
  await agentRoutes(app);

  const mcpServer = createMcpServer(redis);
  registerMcpTransport(app, mcpServer, redis);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-dispatcher listening on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    await redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: Error) => { console.error('Fatal:', err); process.exit(1); });
