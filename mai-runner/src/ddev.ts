import { execCapture, type ExecResult } from './proc.js';
import type { Worktree } from './worktree.js';

/**
 * Each worktree is a separate directory, so ddev treats it as a separate project.
 * ddev's Traefik-based router (v1.22+) namespaces every project under its own
 * <name>.ddev.site hostname — a unique project name per worktree is sufficient
 * for safe concurrent execution, no manual port bookkeeping required.
 */
function ddevProjectName(taskId: string): string {
  return `t-${taskId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
}

export async function ddevUp(worktree: Worktree, taskId: string): Promise<ExecResult> {
  const projectName = ddevProjectName(taskId);
  const config = await execCapture(
    `ddev config --project-name=${projectName} --update-config`,
    { cwd: worktree.path, timeoutMs: 60_000 }
  );
  if (config.exitCode !== 0) return config;
  return execCapture(`ddev start`, { cwd: worktree.path, timeoutMs: 5 * 60_000 });
}

export async function ddevExec(worktree: Worktree, command: string, timeoutMs = 10 * 60_000): Promise<ExecResult> {
  return execCapture(`ddev exec ${command}`, { cwd: worktree.path, timeoutMs });
}

/** `-O` omits the snapshot — full teardown, no leftover volumes on the root server. */
export async function ddevDown(worktree: Worktree): Promise<void> {
  await execCapture(`ddev delete -O -y`, { cwd: worktree.path, timeoutMs: 60_000 });
}
