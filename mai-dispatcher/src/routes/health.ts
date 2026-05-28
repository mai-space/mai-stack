import type { FastifyInstance } from 'fastify';
import { getAgentProfiles } from '../config.js';

const startTime = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'mai-dispatcher',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    agents_loaded: getAgentProfiles().length,
  }));
}
