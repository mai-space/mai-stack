import type { FastifyInstance } from 'fastify';
import { getAgentProfiles } from '../config.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents', async () => getAgentProfiles());
}
