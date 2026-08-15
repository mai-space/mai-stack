import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';

async function buildApp(secret: string | undefined) {
  vi.resetModules();
  if (secret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = secret;
  const { authRoutes } = await import('../server/routes/auth.js');
  const app = Fastify();
  await app.register(authRoutes);
  return app;
}

function extractCookie(setCookieHeader: unknown): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : (setCookieHeader as string | undefined);
  return raw?.split(';')[0] ?? '';
}

describe('dashboard auth routes', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DASHBOARD_SECRET;
  });

  it('rejects login with the wrong secret', async () => {
    const app = await buildApp('correct-secret');
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: 'wrong' } });
    expect(res.statusCode).toBe(401);
  });

  it('accepts login with the correct secret and sets an HttpOnly cookie', async () => {
    const app = await buildApp('correct-secret');
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: 'correct-secret' } });
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('mai_session=');
  });

  it('a session cookie from login passes /auth/check', async () => {
    const app = await buildApp('correct-secret');
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: 'correct-secret' } });
    const cookie = extractCookie(login.headers['set-cookie']);

    const check = await app.inject({ method: 'GET', url: '/auth/check', headers: { cookie } });
    expect(check.statusCode).toBe(200);
    expect(check.json().authenticated).toBe(true);
  });

  it('/auth/check fails without a cookie', async () => {
    const app = await buildApp('correct-secret');
    const res = await app.inject({ method: 'GET', url: '/auth/check' });
    expect(res.statusCode).toBe(401);
  });

  it('a tampered cookie fails /auth/check', async () => {
    const app = await buildApp('correct-secret');
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: 'correct-secret' } });
    const cookie = extractCookie(login.headers['set-cookie']);
    const [name, value] = cookie.split('=');
    const tamperedValue = value.slice(0, -1) + (value.at(-1) === 'a' ? 'b' : 'a');

    const check = await app.inject({ method: 'GET', url: '/auth/check', headers: { cookie: `${name}=${tamperedValue}` } });
    expect(check.statusCode).toBe(401);
  });

  it('a session older than 24h fails verification', async () => {
    // Fastify's inject() relies on real timers internally, so this fakes only Date.now()
    // rather than using vi.useFakeTimers() (which hangs inject()).
    const app = await buildApp('correct-secret');
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: 'correct-secret' } });
    const cookie = extractCookie(login.headers['set-cookie']);

    const realNow = Date.now;
    Date.now = () => realNow() + 25 * 60 * 60 * 1000;
    try {
      const check = await app.inject({ method: 'GET', url: '/auth/check', headers: { cookie } });
      expect(check.statusCode).toBe(401);
    } finally {
      Date.now = realNow;
    }
  });

  it('logout clears the cookie', async () => {
    const app = await buildApp('correct-secret');
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: 'correct-secret' } });
    const cookie = extractCookie(login.headers['set-cookie']);

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('/auth/check always succeeds when DASHBOARD_SECRET is unset (dev mode)', async () => {
    const app = await buildApp(undefined);
    const res = await app.inject({ method: 'GET', url: '/auth/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json().authenticated).toBe(true);
  });

  it('login always fails when DASHBOARD_SECRET is unset', async () => {
    const app = await buildApp(undefined);
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { secret: '' } });
    expect(res.statusCode).toBe(401);
  });
});
