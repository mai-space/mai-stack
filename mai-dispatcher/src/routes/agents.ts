import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAgentProfiles } from '../config.js';
import { getBudgetStatus, getAgentState, setAgentState } from '../governance.js';
import { getRedis } from '../redis.js';
import { issueSession } from '../auth.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/agents', async () => getAgentProfiles());

  app.post('/agents/:agentId/session', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const profile = getAgentProfiles().find(p => p.id === agentId);
    if (!profile) return reply.status(404).send({ error: 'Agent not found' });

    const body = z.object({
      task_id: z.string().optional(),
      ttl_seconds: z.number().int().positive().max(24 * 3600).optional(),
    }).parse(request.body ?? {});

    const redis = await getRedis();
    const session = await issueSession(redis, agentId, { taskId: body.task_id, ttlSeconds: body.ttl_seconds });
    return session;
  });

  app.get('/agents/:agentId/budget', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const profile = getAgentProfiles().find(p => p.id === agentId);
    if (!profile) return reply.status(404).send({ error: 'Agent not found' });
    const redis = await getRedis();
    return getBudgetStatus(redis, profile);
  });

  app.post('/agents/:agentId/resume', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const profile = getAgentProfiles().find(p => p.id === agentId);
    if (!profile) return reply.status(404).send({ error: 'Agent not found' });

    const redis = await getRedis();
    const state = await getAgentState(redis, agentId);

    if (state !== 'HARD_PAUSE') {
      return reply.status(409).send({
        error: 'Agent is not in HARD_PAUSE state',
        current_state: state,
      });
    }

    await setAgentState(redis, agentId, 'IDLE');
    return { agent_id: agentId, resumed: true, previous_state: 'HARD_PAUSE', new_state: 'IDLE' };
  });
}
