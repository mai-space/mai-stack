import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDb, runMigrations } from './db/client.js';
import { getRedis } from './redis.js';
import { healthRoutes } from './routes/health.js';
import { entryRoutes } from './routes/entries.js';

const PORT = parseInt(process.env.PORT ?? '3462', 10);
const DB_PATH = process.env.DB_PATH ?? './journal.db';

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) {
    console.error('[startup] REDIS_URL is required');
    process.exit(1);
  }

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
  await entryRoutes(app, db, redis);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-journal listening on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    await redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: Error) => { console.error('Fatal:', err); process.exit(1); });
