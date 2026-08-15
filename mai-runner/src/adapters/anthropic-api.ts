import type { AgentAdapter, AdapterContext } from './types.js';
import { connectMcpBridge, type McpBridge, type McpToolDescriptor } from '../mcpBridge.js';
import { appendJournal } from '../journalClient.js';

const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';
const SYSTEM_PROMPT =
  'You are a coding agent working inside an isolated git worktree. Use the available MCP tools ' +
  'to inspect and modify code, and to report blockers via request_decision/request_clarification/flag_risk/create_subtask.';
const MAX_TURNS = 40;

function toAnthropicTools(tools: McpToolDescriptor[]) {
  return tools.map(t => ({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema }));
}

/**
 * Reference `api`-family adapter — no subprocess. Drives the Anthropic Messages API's
 * tool-use loop directly, bridging tool calls through the in-process MCP client. Every
 * other api adapter (openai-api, opencode-go-api, opencode-zen-api) follows this shape.
 */
export function createAnthropicApiAdapter(): AgentAdapter {
  let bridge: McpBridge | null = null;

  return {
    family: 'api',

    async prepare(ctx: AdapterContext) {
      bridge = await connectMcpBridge(`${DISPATCHER_URL}/sse`, ctx.profile.id, ctx.session.token);
    },

    async invoke(ctx: AdapterContext, manifest: string) {
      if (!bridge) throw new Error('adapter.prepare() must run before invoke()');
      const api = ctx.profile.api;
      if (!api) throw new Error(`agent ${ctx.profile.id} (type anthropic-api) is missing an api: config block`);
      const apiKey = process.env[api.api_key_env];
      if (!apiKey) throw new Error(`env var ${api.api_key_env} is not set`);

      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey, baseURL: api.base_url });
      const tools = toAnthropicTools(await bridge.listTools());
      const messages: any[] = [{ role: 'user', content: manifest }];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await client.messages.create({
          model: api.model,
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages,
          tools,
        } as any);

        await appendJournal(ctx.taskId, 'agent_output', { stream: 'model', turn, stop_reason: response.stop_reason, content: response.content }, { projectId: ctx.projectId, agentId: ctx.profile.id });
        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason !== 'tool_use') {
          await appendJournal(ctx.taskId, 'agent_finished', { exit_code: 0, turns: turn + 1 }, { projectId: ctx.projectId, agentId: ctx.profile.id });
          return { exitCode: 0 };
        }

        const toolResults: any[] = [];
        for (const block of response.content as any[]) {
          if (block.type !== 'tool_use') continue;
          try {
            const result = await bridge.callTool(block.name, block.input as Record<string, unknown>);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          } catch (err) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${String(err)}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: toolResults });
      }

      await appendJournal(ctx.taskId, 'error', { message: `hit MAX_TURNS (${MAX_TURNS}) without stopping` }, { projectId: ctx.projectId, agentId: ctx.profile.id });
      return { exitCode: 1 };
    },

    async dispose() {
      if (bridge) { await bridge.close(); bridge = null; }
    },
  };
}
