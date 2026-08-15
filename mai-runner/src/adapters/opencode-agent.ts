import { writeFile } from 'node:fs/promises';
import type { AgentAdapter, AdapterContext } from './types.js';
import { dispatcherSseUrl, runCliAgent } from './cliShared.js';

/**
 * opencode's own CLI in non-interactive run mode (`opencode run "<prompt>"` —
 * configured via agents.yml `cli.args`). MCP servers go in `opencode.json`'s `mcp`
 * block at the worktree root.
 */
export function createOpencodeAgentAdapter(): AgentAdapter {
  return {
    family: 'cli',

    async prepare(ctx: AdapterContext) {
      const config = {
        mcp: {
          'mai-dispatcher': { type: 'remote', url: dispatcherSseUrl(ctx) },
        },
      };
      await writeFile(`${ctx.worktree.path}/opencode.json`, JSON.stringify(config, null, 2));
    },

    invoke: (ctx, manifest) => runCliAgent(ctx, manifest),

    async dispose() {},
  };
}
