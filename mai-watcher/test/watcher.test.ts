import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// USE_POLLING avoids relying on inotify/fsevents inside sandboxed/container filesystems.
// Short DEBOUNCE_MS/POLLING_INTERVAL_MS keep the test fast; watcher.ts reads these from
// process.env at module load, so they must be set before the dynamic import below runs.
process.env.DEBOUNCE_MS = '100';
process.env.USE_POLLING = 'true';
process.env.POLLING_INTERVAL_MS = '50';

const { setupWatcher, stopWatcher, getActiveProjectIds } = await import('../src/watcher.js');

function createFakeRedis() {
  const store = new Map<string, string>();
  const published: Array<{ channel: string; message: string }> = [];
  return {
    store,
    published,
    async set(key: string, value: string) { store.set(key, value); },
    async publish(channel: string, message: string) { published.push({ channel, message }); },
  };
}

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'mai-watcher-test-'));
}

describe('setupWatcher / stopWatcher', () => {
  it('tracks active project ids and stopWatcher removes them idempotently', () => {
    const dir = tempWorkspace();
    const redis = createFakeRedis();
    setupWatcher({ id: 'proj-ids', workspace_path: dir, embedding_model: 'x' }, redis as any);
    expect(getActiveProjectIds()).toContain('proj-ids');

    stopWatcher('proj-ids');
    expect(getActiveProjectIds()).not.toContain('proj-ids');
    expect(() => stopWatcher('proj-ids')).not.toThrow(); // stopping twice is a no-op

    rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when already watching the same project id', () => {
    const dir = tempWorkspace();
    const redis = createFakeRedis();
    setupWatcher({ id: 'proj-dup', workspace_path: dir, embedding_model: 'x' }, redis as any);
    setupWatcher({ id: 'proj-dup', workspace_path: dir, embedding_model: 'x' }, redis as any);
    expect(getActiveProjectIds().filter(id => id === 'proj-dup')).toHaveLength(1);

    stopWatcher('proj-dup');
    rmSync(dir, { recursive: true, force: true });
  });

  it('sets a dirty flag and publishes files_changed after a real file write', async () => {
    const dir = tempWorkspace();
    const redis = createFakeRedis();
    setupWatcher({ id: 'proj-dirty', workspace_path: dir, embedding_model: 'x' }, redis as any);

    // let chokidar's initial scan settle before triggering a real change
    await new Promise(r => setTimeout(r, 300));
    writeFileSync(join(dir, 'file.ts'), 'export const x = 1;');

    const deadline = Date.now() + 5000;
    while (!redis.store.has('project:proj-dirty:dirty') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }

    expect(redis.store.get('project:proj-dirty:dirty')).toBe('1');
    expect(redis.store.has('project:proj-dirty:last_changed_at')).toBe(true);
    expect(redis.published.some(p => p.channel === 'project:proj-dirty:files_changed')).toBe(true);

    stopWatcher('proj-dirty');
    rmSync(dir, { recursive: true, force: true });
  }, 8000);
});
