import type { FastifyInstance } from 'fastify';

const startTime = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'mai-registry',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }));
}
