import { createClient } from 'redis';
import type { AgentProfile } from './config.js';
import { getEligibleProjects, type ProjectConfig } from './config.js';
import { DispatcherClient } from './dispatcherClient.js';
import { tryAcquireSlot, releaseSlot, createWorktree, destroyWorktree, type Worktree } from './worktree.js';
import { ddevUp, ddevDown } from './ddev.js';
import { runQualityGates } from './gates.js';
import { commitPushAndOpenPr } from './git.js';
import { getAdapterFactory } from './invoke.js';
import { appendJournal } from './journalClient.js';

type RedisClient = ReturnType<typeof createClient>;

const POLL_INTERVAL_MS = parseInt(process.env.RUNNER_POLL_INTERVAL_MS ?? '15000', 10);

export interface ActiveRun {
  taskId: string;
  projectId: string;
  agentId: string;
  branch: string;
  worktreePath: string;
  startedAt: string;
}

interface TrackedRun extends ActiveRun {
  kill: () => void;
}

const activeRuns = new Map<string, TrackedRun>();

export function listActiveRuns(): ActiveRun[] {
  return [...activeRuns.values()].map(({ kill: _kill, ...rest }) => rest);
}

export function killRun(taskId: string): boolean {
  const run = activeRuns.get(taskId);
  if (!run) return false;
  run.kill();
  return true;
}

async function runTask(
  redis: RedisClient,
  profile: AgentProfile,
  project: ProjectConfig,
  taskId: string,
  taskTitle: string,
  taskDescription: string | null,
  manifest: string
): Promise<void> {
  const dispatcher = new DispatcherClient(profile.id);
  const adapter = getAdapterFactory(profile.type)();

  let worktree: Worktree | null = null;
  let killed = false;

  activeRuns.set(taskId, {
    taskId, projectId: project.id, agentId: profile.id, branch: '', worktreePath: '',
    startedAt: new Date().toISOString(), kill: () => { killed = true; },
  });

  try {
    worktree = await createWorktree(project, taskId, taskTitle);
    const run = activeRuns.get(taskId);
    if (run) { run.branch = worktree.branch; run.worktreePath = worktree.path; }

    await appendJournal(taskId, 'agent_started', {
      agent_id: profile.id, adapter: profile.type, worktree: worktree.path, branch: worktree.branch,
    }, { projectId: project.id, agentId: profile.id });

    if (project.runtime.type === 'ddev') {
      const up = await ddevUp(worktree, taskId);
      if (up.exitCode !== 0) throw new Error(`ddev start failed: ${up.stderr || up.stdout}`);
    }

    let gatesPassed = false;
    let currentManifest = manifest;
    const maxAttempts = profile.max_gate_retries ?? 1;

    for (let attempt = 1; attempt <= maxAttempts && !killed; attempt++) {
      const session = await dispatcher.issueTaskSession(taskId);
      const ctx = { worktree, profile, taskId, projectId: project.id, session };

      await adapter.dispose(); // no-op on first attempt; closes any prior attempt's MCP bridge otherwise
      await adapter.prepare(ctx);
      const { exitCode } = await adapter.invoke(ctx, currentManifest);

      if (exitCode !== 0) {
        await appendJournal(taskId, 'error', { message: `agent exited with code ${exitCode} on attempt ${attempt}` }, { projectId: project.id, agentId: profile.id });
        continue;
      }

      const gates = await runQualityGates(project, worktree, taskId);
      gatesPassed = gates.every(g => g.pass);
      if (gatesPassed) break;

      const failures = gates.filter(g => !g.pass).map(g => `${g.gate}:\n${g.output}`).join('\n\n');
      currentManifest = `${manifest}\n\n═══ GATE FAILURES (attempt ${attempt}) ═══\n${failures}\nFix the above and try again.`;
    }

    if (project.runtime.type === 'ddev') await ddevDown(worktree);

    if (killed) {
      await appendJournal(taskId, 'error', { message: 'run killed via control API' }, { projectId: project.id, agentId: profile.id });
      await destroyWorktree(project, worktree, { keep: true });
      return;
    }

    if (!gatesPassed) {
      await dispatcher.flagRisk(taskId, `Quality gates failed after ${maxAttempts} attempt(s)`, 'medium');
      await destroyWorktree(project, worktree, { keep: true });
      return;
    }

    const { pr_url } = await commitPushAndOpenPr(project, worktree, { id: taskId, title: taskTitle, description: taskDescription });
    await dispatcher.completeTask(taskId);
    await destroyWorktree(project, worktree, { keep: false });
    await appendJournal(taskId, 'run_complete', { branch: worktree.branch, pr_url }, { projectId: project.id, agentId: profile.id });
  } catch (err) {
    await appendJournal(taskId, 'error', { message: String(err) }, { projectId: project.id, agentId: profile.id });
    if (worktree) await destroyWorktree(project, worktree, { keep: true });
    try {
      await dispatcher.flagRisk(taskId, `mai-runner error: ${String(err)}`, 'medium');
    } catch {
      /* best effort — the task stays IN_PROGRESS and its lease will expire and re-queue it */
    }
  } finally {
    await adapter.dispose();
    await releaseSlot(redis, project);
    activeRuns.delete(taskId);
  }
}

/** One supervisor loop per managed agent profile, started once at boot and running for the process lifetime. */
export function startManagedAgentLoop(redis: RedisClient, profile: AgentProfile): void {
  const dispatcher = new DispatcherClient(profile.id);
  console.log(`[loop] starting managed agent loop for ${profile.id} (type=${profile.type})`);

  async function tick(): Promise<void> {
    try {
      for (const project of getEligibleProjects(profile)) {
        const acquired = await tryAcquireSlot(redis, project, profile.max_parallel_worktrees);
        if (!acquired) continue;

        const claimed = await dispatcher.claimTask(project.id);
        if (!claimed.task) {
          await releaseSlot(redis, project);
          continue;
        }

        const { id, title, description } = claimed.task;
        void runTask(redis, profile, project, id, title, description, claimed.context_manifest ?? title);
      }
    } catch (err) {
      console.error(`[loop] ${profile.id} tick failed:`, String(err));
    } finally {
      setTimeout(() => void tick(), POLL_INTERVAL_MS);
    }
  }

  void tick();
}
