import type { FastifyInstance } from 'fastify';
import { listActiveRuns, killRun } from '../loop.js';

export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.get('/runs', async () => listActiveRuns());

  app.post('/runs/:taskId/kill', async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const killed = killRun(taskId);
    if (!killed) return reply.status(404).send({ error: 'No active run for this task' });
    return { task_id: taskId, killed: true };
  });
}
