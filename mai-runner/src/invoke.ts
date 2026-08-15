import type { AdapterFactory } from './adapters/types.js';
import { createClaudeCliAdapter } from './adapters/claude-cli.js';
import { createCodexCliAdapter } from './adapters/codex-cli.js';
import { createCursorAgentAdapter } from './adapters/cursor-agent.js';
import { createOpencodeAgentAdapter } from './adapters/opencode-agent.js';
import { createAnthropicApiAdapter } from './adapters/anthropic-api.js';
import { createOpenAiApiAdapter } from './adapters/openai-api.js';
import { createOpencodeGoApiAdapter } from './adapters/opencode-go-api.js';
import { createOpencodeZenApiAdapter } from './adapters/opencode-zen-api.js';

/**
 * `antigravity-cli` is deliberately absent — M-6.md marks it as spike-required until its
 * MCP config format is verified against the real tool. Adding a profile with
 * `type: antigravity-cli` fails fast via getAdapterFactory() below rather than silently
 * misbehaving.
 */
const registry: Record<string, AdapterFactory> = {
  'claude-cli': createClaudeCliAdapter,
  'codex-cli': createCodexCliAdapter,
  'cursor-agent': createCursorAgentAdapter,
  'opencode-agent': createOpencodeAgentAdapter,
  'anthropic-api': createAnthropicApiAdapter,
  'openai-api': createOpenAiApiAdapter,
  'opencode-go-api': createOpencodeGoApiAdapter,
  'opencode-zen-api': createOpencodeZenApiAdapter,
};

export function getAdapterFactory(type: string): AdapterFactory {
  const factory = registry[type];
  if (!factory) {
    throw new Error(
      `no managed-agent adapter for type "${type}". Supported: ${Object.keys(registry).join(', ')}` +
      (type === 'antigravity-cli' ? ' — antigravity-cli is a planned adapter pending a config-format verification spike (see M-6.md RISK 7)' : '')
    );
  }
  return factory;
}
