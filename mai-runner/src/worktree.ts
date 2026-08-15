import { createClient } from 'redis';
import { execCapture, shellQuote } from './proc.js';
import type { ProjectConfig } from './config.js';

type RedisClient = ReturnType<typeof createClient>;

export interface Worktree {
  path: string;
  branch: string;
  taskId: string;
}

const RUNNER_MAX_GLOBAL_WORKTREES = parseInt(process.env.RUNNER_MAX_GLOBAL_WORKTREES ?? '3', 10);

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'task';
}

function globalKey(): string {
  return 'runner:global:worktrees';
}

function projectKey(projectId: string): string {
  return `runner:${projectId}:worktrees`;
}

/**
 * The one control that actually protects the root server from OOM: a ddev-backed
 * worktree is a full PHP-FPM + MySQL stack, so global concurrency across every
 * project and every managed agent is capped independently of any per-agent/
 * per-project cap. See M-6.md RISK 3.
 */
export async function tryAcquireSlot(redis: RedisClient, project: ProjectConfig, agentMaxParallel: number): Promise<boolean> {
  const [globalRaw, projectRaw] = await Promise.all([
    redis.get(globalKey()),
    redis.get(projectKey(project.id)),
  ]);
  const globalCount = parseInt(globalRaw ?? '0', 10);
  const projectCount = parseInt(projectRaw ?? '0', 10);
  const projectCap = Math.min(agentMaxParallel, project.runtime.max_parallel_worktrees);

  if (globalCount >= RUNNER_MAX_GLOBAL_WORKTREES || projectCount >= projectCap) return false;

  await redis.incr(globalKey());
  await redis.incr(projectKey(project.id));
  return true;
}

export async function releaseSlot(redis: RedisClient, project: ProjectConfig): Promise<void> {
  const g = await redis.decr(globalKey());
  if (g < 0) await redis.set(globalKey(), '0');
  const p = await redis.decr(projectKey(project.id));
  if (p < 0) await redis.set(projectKey(project.id), '0');
}

export async function createWorktree(project: ProjectConfig, taskId: string, taskTitle: string): Promise<Worktree> {
  const base = project.workspace;
  const branch = `agent/${taskId}-${slugify(taskTitle)}`;
  const path = `${base}/.worktrees/task-${taskId}`;
  const baseBranch = project.repo?.base_branch ?? 'main';

  await execCapture(`git fetch origin ${shellQuote(baseBranch)}`, { cwd: base });
  const add = await execCapture(
    `git worktree add ${shellQuote(path)} -b ${shellQuote(branch)} origin/${baseBranch}`,
    { cwd: base }
  );
  if (add.exitCode !== 0) {
    throw new Error(`git worktree add failed for task ${taskId}: ${add.stderr || add.stdout}`);
  }
  return { path, branch, taskId };
}

/** `keep: true` when a task ends BLOCKED — leaves the branch/worktree so a resumed run reuses it instead of starting over. */
export async function destroyWorktree(project: ProjectConfig, wt: Worktree, opts: { keep: boolean }): Promise<void> {
  if (opts.keep) return;
  await execCapture(`git worktree remove ${shellQuote(wt.path)} --force`, { cwd: project.workspace });
  await execCapture(`git branch -D ${shellQuote(wt.branch)}`, { cwd: project.workspace }); // no-op if already pushed/merged away
}
