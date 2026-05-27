import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDb, runMigrations } from './db/client.js';
import { seedFromYaml } from './seed/fromYaml.js';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';

const PORT = parseInt(process.env.PORT ?? '3459', 10);
const DB_PATH = process.env.DB_PATH ?? './registry.db';
const CONFIG_PATH = process.env.CONFIG_PATH ?? '/config/projects.yml';

async function main() {
  const db = getDb(DB_PATH);
  await runMigrations(db);
  await seedFromYaml(db, CONFIG_PATH);

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors);

  // Error handling for Zod validation errors
  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') {
      return reply.status(400).send({ error: 'Validation error', details: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await healthRoutes(app);
  await projectRoutes(app, db);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-registry listening on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
