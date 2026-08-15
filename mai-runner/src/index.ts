import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getRedis } from './redis.js';
import { loadAgentProfiles, loadProjectConfigs, getManagedProfiles } from './config.js';
import { startManagedAgentLoop } from './loop.js';
import { healthRoutes } from './routes/health.js';
import { runRoutes } from './routes/runs.js';

const PORT = parseInt(process.env.PORT ?? '3463', 10);
const AGENTS_CONFIG_PATH = process.env.CONFIG_PATH ?? '/config/agents.yml';
const PROJECTS_CONFIG_PATH = process.env.PROJECTS_CONFIG_PATH ?? '/config/projects.yml';

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) {
    console.error('[startup] REDIS_URL is required');
    process.exit(1);
  }

  const redis = await getRedis();
  loadAgentProfiles(AGENTS_CONFIG_PATH);
  loadProjectConfigs(PROJECTS_CONFIG_PATH);

  const managed = getManagedProfiles();
  if (managed.length === 0) {
    console.warn('[startup] no agents with mode: managed found — mai-runner has nothing to supervise');
  }
  for (const profile of managed) {
    startManagedAgentLoop(redis, profile);
  }

  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors);

  app.setErrorHandler((error, _request, reply) => {
    if (error.name === 'ZodError') return reply.status(400).send({ error: 'Validation error', details: error.message });
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await healthRoutes(app);
  await runRoutes(app);

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`mai-runner listening on port ${PORT}`);

  const shutdown = async () => {
    await app.close();
    await redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: Error) => { console.error('Fatal:', err); process.exit(1); });
