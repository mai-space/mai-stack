import { createHmac } from 'node:crypto';
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET ?? '';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'mai_session';
function sign(payload) {
    return createHmac('sha256', DASHBOARD_SECRET).update(payload).digest('hex');
}
function makeToken() {
    const ts = Date.now().toString();
    return `${ts}.${sign(ts)}`;
}
export function verifyToken(token) {
    if (!token || !DASHBOARD_SECRET)
        return false;
    const dot = token.lastIndexOf('.');
    if (dot < 0)
        return false;
    const ts = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = sign(ts);
    if (sig.length !== expected.length)
        return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++)
        diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0)
        return false;
    return Date.now() - parseInt(ts, 10) < SESSION_TTL_MS;
}
function parseCookies(raw) {
    if (!raw)
        return {};
    return Object.fromEntries(raw.split(';').map(s => {
        const eq = s.indexOf('=');
        return eq < 0 ? [s.trim(), ''] : [s.slice(0, eq).trim(), s.slice(eq + 1).trim()];
    }));
}
export function getSessionToken(request) {
    return parseCookies(request.headers.cookie)[COOKIE_NAME];
}
export async function authRoutes(app) {
    app.post('/auth/login', async (req, reply) => {
        const body = req.body;
        if (!DASHBOARD_SECRET || body?.secret !== DASHBOARD_SECRET) {
            return reply.status(401).send({ error: 'Invalid secret' });
        }
        const token = makeToken();
        reply.header('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
        return { ok: true };
    });
    app.post('/auth/logout', async (_req, reply) => {
        reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
        return { ok: true };
    });
    app.get('/auth/check', async (req, reply) => {
        if (!DASHBOARD_SECRET)
            return { authenticated: true };
        const token = getSessionToken(req);
        if (!verifyToken(token))
            return reply.status(401).send({ authenticated: false });
        return { authenticated: true };
    });
}
