import { mkdir, writeFile } from 'node:fs/promises';
import type { AgentAdapter, AdapterContext } from './types.js';
import { dispatcherSseUrl, runCliAgent } from './cliShared.js';

/**
 * Cursor's CLI agent ("cursor-agent" / background-agent mode). MCP config is
 * project-level: `.cursor/mcp.json` inside the worktree, same shape as Claude Code's
 * `.mcp.json`. Requires the CLI to already be authenticated (Cursor login/token) in
 * the runner's environment — non-interactive first-run login is not handled here,
 * see M-6.md RISK 7.
 */
export function createCursorAgentAdapter(): AgentAdapter {
  return {
    family: 'cli',

    async prepare(ctx: AdapterContext) {
      const dir = `${ctx.worktree.path}/.cursor`;
      await mkdir(dir, { recursive: true });
      const config = {
        mcpServers: {
          'mai-dispatcher': { type: 'sse', url: dispatcherSseUrl(ctx) },
        },
      };
      await writeFile(`${dir}/mcp.json`, JSON.stringify(config, null, 2));
    },

    invoke: (ctx, manifest) => runCliAgent(ctx, manifest),

    async dispose() {},
  };
}
