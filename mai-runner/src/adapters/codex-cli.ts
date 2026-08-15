import { mkdir, writeFile } from 'node:fs/promises';
import type { AgentAdapter, AdapterContext } from './types.js';
import { dispatcherSseUrl, runCliAgent } from './cliShared.js';

/**
 * OpenAI Codex CLI. Config lives in a TOML file under $CODEX_HOME (default ~/.codex) —
 * we point CODEX_HOME at a per-task directory inside the worktree so concurrent runs
 * never share config, and so nothing survives worktree teardown.
 *
 * NOTE: the exact `[mcp_servers.*]` TOML shape (in particular whether an SSE `url` is
 * accepted directly or only stdio `command`/`args` servers) should be verified against
 * the installed codex-cli version before relying on this in production — see M-6.md
 * RISK 7. agents.yml's `cli.args` should include the non-interactive subcommand
 * (e.g. `["exec"]`) the same way it would for any other cli-family adapter.
 */
export function createCodexCliAdapter(): AgentAdapter {
  let codexHome = '';

  return {
    family: 'cli',

    async prepare(ctx: AdapterContext) {
      codexHome = `${ctx.worktree.path}/.codex-home`;
      await mkdir(codexHome, { recursive: true });
      const toml = [
        '[mcp_servers.mai]',
        `url = "${dispatcherSseUrl(ctx)}"`,
        '',
      ].join('\n');
      await writeFile(`${codexHome}/config.toml`, toml);
    },

    invoke: (ctx, manifest) => runCliAgent(ctx, manifest, { CODEX_HOME: codexHome }),

    async dispose() {},
  };
}
