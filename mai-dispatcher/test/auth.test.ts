import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFakeRedis } from './fakeRedis.js';
import { isAuthRequired, issueSession, verifySession, revokeSession } from '../src/auth.js';

describe('isAuthRequired', () => {
  afterEach(() => { delete process.env.DISPATCHER_AUTH_REQUIRED; });

  it('is false by default (dev-mode bypass)', () => {
    delete process.env.DISPATCHER_AUTH_REQUIRED;
    expect(isAuthRequired()).toBe(false);
  });

  it('is true only when explicitly set to "true"', () => {
    process.env.DISPATCHER_AUTH_REQUIRED = 'true';
    expect(isAuthRequired()).toBe(true);
    process.env.DISPATCHER_AUTH_REQUIRED = '1';
    expect(isAuthRequired()).toBe(false);
  });
});

describe('issueSession / verifySession / revokeSession', () => {
  let redis: ReturnType<typeof createFakeRedis>;

  beforeEach(() => {
    redis = createFakeRedis();
    process.env.DISPATCHER_AUTH_REQUIRED = 'true';
  });

  afterEach(() => { delete process.env.DISPATCHER_AUTH_REQUIRED; });

  it('verifies a freshly issued session for the agent it was issued to', async () => {
    const session = await issueSession(redis as any, 'agent-1');
    expect(await verifySession(redis as any, session.token, 'agent-1')).toBe(true);
  });

  it('rejects the token for a different agent id', async () => {
    const session = await issueSession(redis as any, 'agent-1');
    expect(await verifySession(redis as any, session.token, 'agent-2')).toBe(false);
  });

  it('rejects a missing or unknown token', async () => {
    expect(await verifySession(redis as any, undefined, 'agent-1')).toBe(false);
    expect(await verifySession(redis as any, 'not-a-real-token', 'agent-1')).toBe(false);
  });

  it('revoking a session makes it fail verification', async () => {
    const session = await issueSession(redis as any, 'agent-1');
    await revokeSession(redis as any, session.token);
    expect(await verifySession(redis as any, session.token, 'agent-1')).toBe(false);
  });

  it('bypasses verification entirely when auth is not required (dev mode)', async () => {
    delete process.env.DISPATCHER_AUTH_REQUIRED;
    expect(await verifySession(redis as any, undefined, undefined)).toBe(true);
  });

  it('scopes a session to a task when task_id is provided', async () => {
    const session = await issueSession(redis as any, 'agent-1', { taskId: 'task-42' });
    const raw = await redis.get(`dispatcher:session:${session.token}`);
    expect(JSON.parse(raw!)).toEqual({ agent_id: 'agent-1', task_id: 'task-42' });
  });
});
