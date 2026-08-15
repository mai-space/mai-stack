import type { AdapterContext } from './types.js';
import { spawnStreaming } from '../proc.js';
import { appendJournal } from '../journalClient.js';

export const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';

export function dispatcherSseUrl(ctx: AdapterContext): string {
  return `${DISPATCHER_URL}/sse?agent_id=${encodeURIComponent(ctx.profile.id)}&token=${encodeURIComponent(ctx.session.token)}`;
}

/**
 * Shared invoke() body for every `cli`-family adapter: template {worktree} into the
 * configured args, append the manifest as the final argument, stream output to the
 * journal. Adapters differ only in what prepare() writes as MCP config.
 */
export async function runCliAgent(ctx: AdapterContext, manifest: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<{ exitCode: number }> {
  const cli = ctx.profile.cli;
  if (!cli) throw new Error(`agent ${ctx.profile.id} (type ${ctx.profile.type}) is missing a cli: config block`);
  const args = cli.args.map(a => a.replace('{worktree}', ctx.worktree.path));

  const result = await spawnStreaming(cli.command, [...args, manifest], {
    cwd: ctx.worktree.path,
    timeoutMs: cli.timeout_minutes * 60_000,
    env: extraEnv,
    onOutput: (stream, text) => {
      void appendJournal(ctx.taskId, 'agent_output', { stream, text }, { projectId: ctx.projectId, agentId: ctx.profile.id });
    },
  });
  await appendJournal(ctx.taskId, 'agent_finished', { exit_code: result.exitCode }, { projectId: ctx.projectId, agentId: ctx.profile.id });
  return result;
}
