import type { AgentAdapter, AdapterContext } from './types.js';
import { connectMcpBridge, type McpBridge, type McpToolDescriptor } from '../mcpBridge.js';
import { appendJournal } from '../journalClient.js';

const DISPATCHER_URL = process.env.DISPATCHER_URL ?? 'http://mai-dispatcher:3460';
const SYSTEM_PROMPT =
  'You are a coding agent working inside an isolated git worktree. Use the available MCP tools ' +
  'to inspect and modify code, and to report blockers via request_decision/request_clarification/flag_risk/create_subtask.';
const MAX_TURNS = 40;

function toOpenAiTools(tools: McpToolDescriptor[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
  }));
}

/**
 * Shared `api`-family adapter for any OpenAI-function-calling-compatible backend.
 * Used directly by `openai-api`, and by `opencode-zen-api` pointed at opencode's hosted
 * model gateway — Zen's exact protocol should be confirmed against its docs before
 * production use (see M-6.md RISK 7 / adapter table); this assumes OpenAI-compatible
 * chat-completions wire format, which is the common shape for model gateways of this kind.
 */
export function createOpenAiCompatibleAdapter(adapterName: string): AgentAdapter {
  let bridge: McpBridge | null = null;

  return {
    family: 'api',

    async prepare(ctx: AdapterContext) {
      bridge = await connectMcpBridge(`${DISPATCHER_URL}/sse`, ctx.profile.id, ctx.session.token);
    },

    async invoke(ctx: AdapterContext, manifest: string) {
      if (!bridge) throw new Error('adapter.prepare() must run before invoke()');
      const api = ctx.profile.api;
      if (!api) throw new Error(`agent ${ctx.profile.id} (type ${adapterName}) is missing an api: config block`);
      const apiKey = process.env[api.api_key_env];
      if (!apiKey) throw new Error(`env var ${api.api_key_env} is not set`);

      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey, baseURL: api.base_url });
      const tools = toOpenAiTools(await bridge.listTools());
      const messages: any[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: manifest },
      ];

      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await client.chat.completions.create({ model: api.model, messages, tools } as any);
        const choice = response.choices[0];
        const message = choice.message;
        await appendJournal(ctx.taskId, 'agent_output', { stream: 'model', turn, finish_reason: choice.finish_reason, content: message.content }, { projectId: ctx.projectId, agentId: ctx.profile.id });
        messages.push(message);

        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          await appendJournal(ctx.taskId, 'agent_finished', { exit_code: 0, turns: turn + 1 }, { projectId: ctx.projectId, agentId: ctx.profile.id });
          return { exitCode: 0 };
        }

        for (const call of toolCalls) {
          try {
            const args = JSON.parse(call.function.arguments || '{}');
            const result = await bridge.callTool(call.function.name, args);
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          } catch (err) {
            messages.push({ role: 'tool', tool_call_id: call.id, content: `Error: ${String(err)}` });
          }
        }
      }

      await appendJournal(ctx.taskId, 'error', { message: `hit MAX_TURNS (${MAX_TURNS}) without stopping` }, { projectId: ctx.projectId, agentId: ctx.profile.id });
      return { exitCode: 1 };
    },

    async dispose() {
      if (bridge) { await bridge.close(); bridge = null; }
    },
  };
}
