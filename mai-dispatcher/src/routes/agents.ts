import type { FastifyInstance } from 'fastify';
import { getAgentProfiles } from '../config.js';
import { getBudgetStatus } from '../governance.js';
import { getRedis } from '../redis.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents', async () => getAgentProfiles());

  app.get('/agents/:agentId/budget', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const profile = getAgentProfiles().find(p => p.id === agentId);
    if (!profile) return reply.status(404).send({ error: 'Agent not found' });
    const redis = await getRedis();
    return getBudgetStatus(redis, profile);
  });
}
