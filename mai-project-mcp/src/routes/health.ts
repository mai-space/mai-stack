import type { FastifyInstance } from 'fastify';
const start = Date.now();
export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ status: 'ok', service: 'mai-project-mcp', uptime: Math.floor((Date.now() - start) / 1000) }));
}
