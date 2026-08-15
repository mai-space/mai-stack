import type { FastifyInstance } from 'fastify';
import { getManagedProfiles } from '../config.js';
import { listActiveRuns } from '../loop.js';

const startTime = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'mai-runner',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    managed_agents: getManagedProfiles().length,
    active_runs: listActiveRuns().length,
  }));
}
