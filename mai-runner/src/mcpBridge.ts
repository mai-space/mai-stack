import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpBridge {
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Connects to mai-dispatcher's MCP gateway as a client — used both by mai-runner's own
 * control loop (claim_task/complete_task/...) and by `api`-family adapters, which need
 * their own task-scoped connection so the model's tool-use loop can call MCP tools
 * directly (create_subtask, request_decision, journal_note, ...).
 *
 * Credentials travel as `?agent_id=&token=` query params rather than custom SSE headers —
 * this is the one auth transport guaranteed to work regardless of the exact
 * @modelcontextprotocol/sdk version's header-injection support, and mai-dispatcher's
 * transport (see mai-dispatcher/src/mcp/transport.ts) accepts either form.
 */
export async function connectMcpBridge(baseSseUrl: string, agentId: string, token: string): Promise<McpBridge> {
  const url = new URL(baseSseUrl);
  url.searchParams.set('agent_id', agentId);
  url.searchParams.set('token', token);

  const transport = new SSEClientTransport(url);
  const client = new Client({ name: 'mai-runner', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  return {
    async listTools() {
      const res = await client.listTools();
      return res.tools as unknown as McpToolDescriptor[];
    },
    async callTool(name: string, args: Record<string, unknown>) {
      return client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close();
    },
  };
}

/** Extracts the JSON payload every mai-dispatcher tool returns as `{ content: [{ type: 'text', text }] }`. */
export function parseToolResult<T = unknown>(result: unknown): T {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content;
  const text = content?.find(c => c.type === 'text')?.text;
  if (!text) return result as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
