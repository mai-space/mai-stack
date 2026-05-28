import chokidar, { type FSWatcher } from 'chokidar';
import { createClient } from 'redis';
import type { Project } from './registry.js';

type RedisClient = ReturnType<typeof createClient>;

const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS ?? '5000', 10);
const USE_POLLING = process.env.USE_POLLING === 'true';
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS ?? '2000', 10);

const activeWatchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const changedPaths = new Map<string, Set<string>>();

export function setupWatcher(project: Project, redis: RedisClient): void {
  if (activeWatchers.has(project.id)) return;

  const watchPath = project.workspace_path;

  const watcher = chokidar.watch(watchPath, {
    ignored: [
      /(^|[/\\])\../,
      /node_modules/,
      /\.git/,
      /[/\\]dist[/\\]/,
      /__pycache__/,
      /\.next/,
      /\.cache/,
    ],
    persistent: true,
    ignoreInitial: true,
    usePolling: USE_POLLING,
    interval: POLLING_INTERVAL_MS,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  watcher.on('error', (err: unknown) => {
    console.warn(`[watcher:${project.id}] error:`, (err as Error).message);
  });

  watcher.on('all', (_event: string, filePath: string) => {
    if (!changedPaths.has(project.id)) changedPaths.set(project.id, new Set());
    changedPaths.get(project.id)!.add(filePath);

    const existing = debounceTimers.get(project.id);
    if (existing) clearTimeout(existing);

    debounceTimers.set(project.id, setTimeout(() => {
      const paths = Array.from(changedPaths.get(project.id) ?? []);
      changedPaths.delete(project.id);
      debounceTimers.delete(project.id);
      flushDirty(redis, project.id, paths).catch(console.error);
    }, DEBOUNCE_MS));
  });

  activeWatchers.set(project.id, watcher);
  console.log(`[watcher:${project.id}] watching ${watchPath} (polling=${USE_POLLING})`);
}

export function stopWatcher(projectId: string): void {
  const timer = debounceTimers.get(projectId);
  if (timer) { clearTimeout(timer); debounceTimers.delete(projectId); }

  const watcher = activeWatchers.get(projectId);
  if (watcher) {
    void watcher.close();
    activeWatchers.delete(projectId);
    console.log(`[watcher:${projectId}] stopped`);
  }
}

export function getActiveProjectIds(): string[] {
  return Array.from(activeWatchers.keys());
}

async function flushDirty(redis: RedisClient, projectId: string, paths: string[]): Promise<void> {
  const now = Date.now().toString();
  await redis.set(`project:${projectId}:dirty`, '1');
  await redis.set(`project:${projectId}:last_changed_at`, now);
  await redis.publish(`project:${projectId}:files_changed`, JSON.stringify({
    project_id: projectId,
    timestamp_ms: now,
    paths_sample: paths.slice(0, 10),
  }));
  console.log(`[watcher:${projectId}] dirty flag set (${paths.length} path(s) changed)`);
}
