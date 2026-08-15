import { writeFile } from 'node:fs/promises';
import type { AgentAdapter, AdapterContext } from './types.js';
import { dispatcherSseUrl, runCliAgent } from './cliShared.js';

/**
 * Reference `cli`-family adapter — every other cli adapter follows this exact shape,
 * only prepare()'s config format differs. Build and validate this one first
 * (see M-6.md build order).
 */
export function createClaudeCliAdapter(): AgentAdapter {
  return {
    family: 'cli',

    async prepare(ctx: AdapterContext) {
      const config = {
        mcpServers: {
          'mai-dispatcher': { type: 'sse', url: dispatcherSseUrl(ctx) },
        },
      };
      await writeFile(`${ctx.worktree.path}/.mcp.json`, JSON.stringify(config, null, 2));
    },

    invoke: (ctx, manifest) => runCliAgent(ctx, manifest),

    async dispose() {
      // nothing to release — the .mcp.json lives with the worktree until teardown
    },
  };
}
