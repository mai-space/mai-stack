import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assembleManifest } from '../src/manifest.js';

const REGISTRY_URL = 'http://mai-registry:3459';
const PROJECT_MCP_URL = 'http://mai-project-mcp:3456';
const CODE_MCP_URL = 'http://mai-code-mcp:3457';
const MEMORY_MCP_URL = 'http://mai-memory-mcp:3458';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as any;
}

function baseTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 't1',
    project_id: 'app-a',
    title: 'Add rate limiting',
    description: 'Add a token-bucket rate limiter to the API gateway',
    status: 'OPEN',
    priority: 1,
    parent_task_id: null,
    blocker_type: null,
    blocker_payload: '{}',
    blocker_resolved_at: null,
    ...overrides,
  };
}

/** Routes a fetch mock by URL, defaulting anything unmatched to a 500 (so gaps fail loudly). */
function routeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: unknown, init?: unknown) => {
    const u = String(url);
    for (const [prefix, response] of Object.entries(routes)) {
      if (u.startsWith(prefix)) return typeof response === 'function' ? (response as any)(u, init) : response;
    }
    return jsonResponse(null, false, 500);
  });
}

describe('assembleManifest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders task/project/agent header and falls back gracefully when nothing else is available', async () => {
    global.fetch = routeFetch({
      [`${REGISTRY_URL}/projects/`]: jsonResponse(null, false, 404),
      [`${CODE_MCP_URL}/search/`]: jsonResponse([]),
      [`${PROJECT_MCP_URL}/`]: jsonResponse(null, false, 500),
      [`${MEMORY_MCP_URL}/`]: jsonResponse([]),
    }) as any;

    const manifest = await assembleManifest(baseTask(), 'agent-1', null);

    expect(manifest).toContain('TASK: #t1 — Add rate limiting');
    expect(manifest).toContain('PROJECT: app-a');
    expect(manifest).toContain('AGENT: agent-1');
    expect(manifest).toContain('(no project context configured)');
    expect(manifest).toContain('(no indexed code chunks — run reindex_project to populate)');
    expect(manifest).toContain('Open: 0  |  Blocked: 0  |  In progress: 0');
    expect(manifest).toContain('No dependencies.');
    expect(manifest).not.toContain('MEMORY RECALL');
    expect(manifest).toContain('Priority: 1. Lease TTL: 5 min (use renew_lease to extend).');
  });

  it('includes the project system prompt, code chunks, state counts and memories when all services respond', async () => {
    global.fetch = routeFetch({
      [`${REGISTRY_URL}/projects/`]: jsonResponse({ id: 'app-a', system_prompt_override: 'Use TypeScript strict mode.', agents_md_path: null }),
      [`${CODE_MCP_URL}/search/`]: jsonResponse([{ file_path: 'src/gateway.ts', line_start: 10, content: 'export function handle() {}', similarity_score: 0.87 }]),
      [`${PROJECT_MCP_URL}/projects/`]: jsonResponse([
        { id: '1', status: 'OPEN' },
        { id: '2', status: 'BLOCKED' },
        { id: '3', status: 'IN_PROGRESS' },
        { id: '4', status: 'DONE', title: 'Set up CI' },
      ]),
      [`${MEMORY_MCP_URL}/`]: jsonResponse([{ id: 'm1', key: 'rate-limiter', value: 'Use token bucket', created_at: '2026-01-01T00:00:00.000Z' }]),
    }) as any;

    const manifest = await assembleManifest(baseTask(), 'agent-1', null);

    expect(manifest).toContain('Use TypeScript strict mode.');
    expect(manifest).toContain('src/gateway.ts');
    expect(manifest).toContain('similarity 0.87');
    expect(manifest).toContain('Open: 1  |  Blocked: 1  |  In progress: 1');
    expect(manifest).toContain('Recently completed: "Set up CI"');
    expect(manifest).toContain('MEMORY RECALL');
    expect(manifest).toContain('Use token bucket');
  });

  it('prepends the stale-index warning to the code section when given', async () => {
    global.fetch = routeFetch({
      [`${REGISTRY_URL}/projects/`]: jsonResponse(null, false, 404),
      [`${CODE_MCP_URL}/search/`]: jsonResponse([]),
      [`${PROJECT_MCP_URL}/`]: jsonResponse(null, false, 500),
      [`${MEMORY_MCP_URL}/`]: jsonResponse([]),
    }) as any;

    const manifest = await assembleManifest(baseTask(), 'agent-1', 'WARNING: index is 2 hours stale');
    expect(manifest).toContain('WARNING: index is 2 hours stale');
  });

  it('renders the prior DECISION resolution when the task was previously blocked and resolved', async () => {
    global.fetch = routeFetch({
      [`${REGISTRY_URL}/projects/`]: jsonResponse(null, false, 404),
      [`${CODE_MCP_URL}/search/`]: jsonResponse([]),
      [`${PROJECT_MCP_URL}/`]: jsonResponse(null, false, 500),
      [`${MEMORY_MCP_URL}/`]: jsonResponse([]),
    }) as any;

    const task = baseTask({
      blocker_type: 'DECISION',
      blocker_payload: JSON.stringify({ question: 'Which cache?', options: ['redis', 'memcached'], choice: 'redis' }),
      blocker_resolved_at: '2026-01-02T00:00:00.000Z',
    });

    const manifest = await assembleManifest(task, 'agent-1', null);

    expect(manifest).toContain('PRIOR RESOLUTION');
    expect(manifest).toContain('Question: "Which cache?"');
    expect(manifest).toContain('Options were: redis, memcached');
    expect(manifest).toContain('Human chose: "redis"');
  });

  it('reads AGENTS.md from disk and folds it into the project context section', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mai-dispatcher-manifest-'));
    const agentsMdPath = join(dir, 'AGENTS.md');
    writeFileSync(agentsMdPath, 'Never touch the payments module directly.');

    global.fetch = routeFetch({
      [`${REGISTRY_URL}/projects/`]: jsonResponse({ id: 'app-a', system_prompt_override: null, agents_md_path: agentsMdPath }),
      [`${CODE_MCP_URL}/search/`]: jsonResponse([]),
      [`${PROJECT_MCP_URL}/`]: jsonResponse(null, false, 500),
      [`${MEMORY_MCP_URL}/`]: jsonResponse([]),
    }) as any;

    try {
      const manifest = await assembleManifest(baseTask(), 'agent-1', null);
      expect(manifest).toContain('Never touch the payments module directly.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
