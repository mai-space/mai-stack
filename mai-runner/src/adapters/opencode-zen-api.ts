import type { AgentAdapter } from './types.js';
import { createOpenAiCompatibleAdapter } from './openAiCompatible.js';

/**
 * opencode's hosted model gateway. Reuses the OpenAI-compatible loop pointed at Zen's
 * `base_url` from agents.yml — confirm Zen's actual wire protocol before shipping this
 * to production (see M-6.md adapter table).
 */
export function createOpencodeZenApiAdapter(): AgentAdapter {
  return createOpenAiCompatibleAdapter('opencode-zen-api');
}
