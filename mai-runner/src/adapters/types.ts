import type { AgentProfile } from '../config.js';
import type { Worktree } from '../worktree.js';
import type { Session } from '../dispatcherClient.js';

export interface AdapterContext {
  worktree: Worktree;
  profile: AgentProfile;
  taskId: string;
  projectId: string;
  /** Task-scoped session token, issued fresh per run — revoked when the run ends. */
  session: Session;
}

export interface AgentAdapter {
  readonly family: 'cli' | 'api';
  /** Writes the tool's own MCP config (cli family) or opens an in-process MCP client (api family). */
  prepare(ctx: AdapterContext): Promise<void>;
  /** Runs the agent to completion against `manifest`. Streams output to the journal as it goes. */
  invoke(ctx: AdapterContext, manifest: string): Promise<{ exitCode: number }>;
  /** Releases whatever prepare() opened (MCP client, temp files). Safe to call even if prepare() was never called. */
  dispose(): Promise<void>;
}

/**
 * One adapter instance is created per task run — never shared across concurrent worktrees
 * of the same agent profile, since `api`-family adapters hold per-run MCP client state.
 */
export type AdapterFactory = () => AgentAdapter;
