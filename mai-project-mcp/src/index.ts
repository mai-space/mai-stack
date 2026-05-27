import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDb, runMigrations } from './db/client.js';
import { getRedis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';
import { createMcpServer } from './mcp/server.js';
import { registerMcpTransport } from './mcp/transport.js';

const PORT = parseInt(process.env.PORT ?? '3456', 10);
const DB_PATH = process.env.DB_PATH ?? './mai.db';

async function main() {
  const db = getDb(DB_PATH);
  await runMigrations(db);
  const redis = await getRedis();

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors);

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await healthRoutes(app);
  await projectRoutes(app, db);
  await taskRoutes(app, db, redis);

  const mcpServer = createMcpServer(db, redis);
  registerMcpTransport(app, mcpServer);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-project-mcp listening on port ${PORT}`);

  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
