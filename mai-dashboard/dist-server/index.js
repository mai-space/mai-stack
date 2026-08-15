import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { WebSocketServer } from 'ws';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initRelay, addClient, removeClient } from './ws-relay.js';
import { healthRoutes } from './routes/health.js';
import { apiRoutes } from './routes/api.js';
import { authRoutes, verifyToken, getSessionToken } from './routes/auth.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3461', 10);
async function main() {
    await initRelay();
    const app = Fastify({ logger: { level: 'info' } });
    await app.register(cors);
    await app.register(authRoutes);
    app.addHook('preHandler', async (request, reply) => {
        const path = request.url.split('?')[0];
        if (path.startsWith('/auth/') || path === '/health')
            return;
        if (!process.env.DASHBOARD_SECRET)
            return;
        const token = getSessionToken(request);
        if (!verifyToken(token)) {
            if (path.startsWith('/api/') || path === '/ws') {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            return reply.sendFile('index.html');
        }
    });
    await app.register(healthRoutes);
    await app.register(apiRoutes, { prefix: '/api' });
    await app.register(staticFiles, {
        root: join(__dirname, '../dist'),
        wildcard: false,
    });
    app.setNotFoundHandler((_req, reply) => {
        return reply.sendFile('index.html');
    });
    await app.listen({ port: PORT, host: '0.0.0.0' });
    const wss = new WebSocketServer({ server: app.server });
    wss.on('connection', (ws) => {
        addClient(ws);
        ws.on('close', () => removeClient(ws));
        ws.on('error', () => removeClient(ws));
    });
    console.log(`mai-dashboard listening on port ${PORT}`);
    const shutdown = async () => { await app.close(); process.exit(0); };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
