import { mkdir, writeFile } from 'node:fs/promises';
import type { AgentAdapter, AdapterContext } from './types.js';
import { dispatcherSseUrl, runCliAgent } from './cliShared.js';

/**
 * JetBrains Junie CLI. MCP config is project-level: `.junie/mcp/mcp.json` inside the
 * worktree, same `mcpServers` key Junie's IDE plugin reads. Unlike claude-cli/cursor-agent,
 * Junie's MCP JSON has no native `type: sse`/`url` entry — every documented remote-server
 * example (JetBrains' own Jira/Figma configs) bridges through `npx -y mcp-remote <url>` as
 * a stdio server, so mai-dispatcher's SSE endpoint is wired the same way here.
 *
 * Non-interactive runs need `--brave=auto` (Junie's "brave mode": auto-approve commands it
 * classifies as safe, still gate on risky ones) — `off` blocks headless with approval
 * prompts nothing can answer, `on` skips approval entirely, matching neither RISK 2's
 * "most restrictive permission mode that still works unattended" guidance nor
 * claude-cli's `acceptEdits` analogue. Requires the CLI already authenticated
 * (`junie --auth` / JetBrains AI login) in the runner's environment, same as cursor-agent.
 */
export function createJunieCliAdapter(): AgentAdapter {
  return {
    family: 'cli',

    async prepare(ctx: AdapterContext) {
      const dir = `${ctx.worktree.path}/.junie/mcp`;
      await mkdir(dir, { recursive: true });
      const config = {
        mcpServers: {
          'mai-dispatcher': { command: 'npx', args: ['-y', 'mcp-remote', dispatcherSseUrl(ctx)] },
        },
      };
      await writeFile(`${dir}/mcp.json`, JSON.stringify(config, null, 2));
    },

    invoke: (ctx, manifest) => runCliAgent(ctx, manifest),

    async dispose() {},
  };
}
