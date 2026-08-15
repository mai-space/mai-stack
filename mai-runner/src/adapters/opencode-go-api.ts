import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentAdapter, AdapterContext } from './types.js';
import { connectMcpBridge, type McpBridge } from '../mcpBridge.js';
import { appendJournal } from '../journalClient.js';

const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';

// One persistent `opencode serve` process per agent profile (not per task) — module-level
// so every task run for this profile reuses it, per M-6.md's description of this adapter.
const servers = new Map<string, { process: ChildProcess; port: number }>();

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

async function ensureServer(profileId: string, command: string): Promise<{ port: number }> {
  const existing = servers.get(profileId);
  if (existing) return { port: existing.port };

  const port = 4200 + (Math.abs(hashCode(profileId)) % 300);
  const proc = spawn(command, ['serve', '--port', String(port)], { stdio: 'ignore' });
  servers.set(profileId, { process: proc, port });
  await new Promise(r => setTimeout(r, 2000)); // best-effort startup grace period
  return { port };
}

/**
 * Drives opencode's own persistent HTTP server (`opencode serve`) instead of spawning a
 * fresh CLI process per task — one long-lived server per agent profile, one session per
 * worktree/task.
 *
 * NOTE: the exact REST shape of `opencode serve` (session creation, message submission)
 * is NOT verified here — this assumes a plausible `POST /session` + `POST
 * /session/:id/message` shape and must be checked against the installed opencode version
 * before production use. See M-6.md RISK 7.
 */
export function createOpencodeGoApiAdapter(): AgentAdapter {
  let bridge: McpBridge | null = null;
  let port = 0;

  return {
    family: 'api',

    async prepare(ctx: AdapterContext) {
      const serverCommand = ctx.profile.cli?.command ?? 'opencode';
      const server = await ensureServer(ctx.profile.id, serverCommand);
      port = server.port;
      bridge = await connectMcpBridge(`${DISPATCHER_URL}/sse`, ctx.profile.id, ctx.session.token);
    },

    async invoke(ctx: AdapterContext, manifest: string) {
      if (!bridge) throw new Error('adapter.prepare() must run before invoke()');
      try {
        const sessionRes = await fetch(`http://127.0.0.1:${port}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: ctx.worktree.path }),
        });
        if (!sessionRes.ok) throw new Error(`opencode serve /session HTTP ${sessionRes.status}`);
        const session = await sessionRes.json() as { id: string };

        const messageRes = await fetch(`http://127.0.0.1:${port}/session/${session.id}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: manifest }),
        });
        const text = await messageRes.text();
        await appendJournal(ctx.taskId, 'agent_output', { stream: 'model', text }, { projectId: ctx.projectId, agentId: ctx.profile.id });

        const exitCode = messageRes.ok ? 0 : 1;
        await appendJournal(ctx.taskId, 'agent_finished', { exit_code: exitCode }, { projectId: ctx.projectId, agentId: ctx.profile.id });
        return { exitCode };
      } catch (err) {
        await appendJournal(ctx.taskId, 'error', { message: String(err) }, { projectId: ctx.projectId, agentId: ctx.profile.id });
        return { exitCode: 1 };
      }
    },

    async dispose() {
      if (bridge) { await bridge.close(); bridge = null; }
      // the opencode serve process is intentionally left running — shared across tasks for this profile
    },
  };
}
