import { execCapture, shellQuote } from './proc.js';
import type { ProjectConfig } from './config.js';
import type { Worktree } from './worktree.js';

interface TaskLike {
  id: string;
  title: string;
  description?: string | null;
}

async function openPullRequest(
  repo: NonNullable<ProjectConfig['repo']>,
  branch: string,
  task: TaskLike
): Promise<{ number: number; html_url: string } | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[git] GITHUB_TOKEN not set — branch was pushed, skipping PR creation');
    return null;
  }
  const res = await fetch(`https://api.github.com/repos/${repo.full_name}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: task.title,
      head: branch,
      base: repo.base_branch,
      body: `${task.description ?? ''}\n\nTask: #${task.id}\n\n---\n_Opened automatically by mai-runner._`,
    }),
  });
  if (!res.ok) {
    console.warn(`[git] failed to open PR for ${branch}: HTTP ${res.status}`);
    return null;
  }
  return res.json() as Promise<{ number: number; html_url: string }>;
}

async function mergePullRequest(repo: NonNullable<ProjectConfig['repo']>, prNumber: number): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  await fetch(`https://api.github.com/repos/${repo.full_name}/pulls/${prNumber}/merge`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
}

export interface CommitResult {
  pr_url?: string;
}

export async function commitPushAndOpenPr(project: ProjectConfig, worktree: Worktree, task: TaskLike): Promise<CommitResult> {
  await execCapture(`git add -A`, { cwd: worktree.path });

  const message = `${task.title}\n\n${task.description ?? ''}\n\nTask: #${task.id}`;
  const commit = await execCapture(`git commit -m ${shellQuote(message)}`, { cwd: worktree.path });
  if (commit.exitCode !== 0 && !/nothing to commit/i.test(commit.stdout)) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }

  const push = await execCapture(`git push -u origin ${shellQuote(worktree.branch)}`, { cwd: worktree.path, timeoutMs: 2 * 60_000 });
  if (push.exitCode !== 0) {
    throw new Error(`git push failed: ${push.stderr || push.stdout}`);
  }

  if (project.pr_strategy === 'push-branch-only' || !project.repo) return {};

  const pr = await openPullRequest(project.repo, worktree.branch, task);
  if (!pr) return {};

  if (project.pr_strategy === 'auto-merge') {
    await mergePullRequest(project.repo, pr.number);
  }

  return { pr_url: pr.html_url };
}
