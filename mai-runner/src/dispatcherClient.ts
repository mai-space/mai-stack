import { connectMcpBridge, parseToolResult, type McpBridge } from './mcpBridge.js';

const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';
const CONTROL_SESSION_TTL_SECONDS = 6 * 3600;

export interface ClaimedTask {
  task: {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
  } | null;
  reason?: string;
  retry_after?: number;
  context_manifest?: string;
  lease_expires_at?: string;
}

export interface Session {
  token: string;
  expires_at: string;
}

async function requestSession(agentId: string, opts: { taskId?: string; ttlSeconds?: number } = {}): Promise<Session> {
  const res = await fetch(`${DISPATCHER_URL}/agents/${agentId}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: opts.taskId, ttl_seconds: opts.ttlSeconds }),
  });
  if (!res.ok) throw new Error(`failed to issue dispatcher session for ${agentId}: HTTP ${res.status}`);
  return res.json() as Promise<Session>;
}

/**
 * Long-lived MCP client used by mai-runner's own supervisor loop — one per managed
 * agent profile, reconnected lazily on failure. Distinct from the per-task, per-worktree
 * bridge that `api`-family adapters open for the model's own tool-use loop.
 */
export class DispatcherClient {
  private bridge: McpBridge | null = null;

  constructor(private agentId: string) {}

  /** Issues a fresh, task-scoped session — handed to an adapter's prepare() step. */
  async issueTaskSession(taskId: string): Promise<Session> {
    return requestSession(this.agentId, { taskId, ttlSeconds: CONTROL_SESSION_TTL_SECONDS });
  }

  private async ensureBridge(): Promise<McpBridge> {
    if (this.bridge) return this.bridge;
    const session = await requestSession(this.agentId, { ttlSeconds: CONTROL_SESSION_TTL_SECONDS });
    this.bridge = await connectMcpBridge(`${DISPATCHER_URL}/sse`, this.agentId, session.token);
    return this.bridge;
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const bridge = await this.ensureBridge();
      return await bridge.callTool(name, args);
    } catch (err) {
      // reconnect on the next call rather than retry inline — keeps the loop simple
      this.bridge = null;
      throw err;
    }
  }

  async claimTask(projectId: string): Promise<ClaimedTask> {
    const result = await this.callTool('claim_task', { project_id: projectId, agent_id: this.agentId });
    return parseToolResult<ClaimedTask>(result);
  }

  async completeTask(taskId: string, costUsd?: number): Promise<unknown> {
    const result = await this.callTool('complete_task', { task_id: taskId, agent_id: this.agentId, cost_usd: costUsd });
    return parseToolResult(result);
  }

  async renewLease(taskId: string): Promise<unknown> {
    const result = await this.callTool('renew_lease', { task_id: taskId, agent_id: this.agentId });
    return parseToolResult(result);
  }

  async flagRisk(taskId: string, description: string, severity: 'low' | 'medium' | 'high' | 'critical'): Promise<unknown> {
    const result = await this.callTool('flag_risk', { task_id: taskId, description, severity });
    return parseToolResult(result);
  }
}
