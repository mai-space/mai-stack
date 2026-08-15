import type { AgentAdapter } from './types.js';
import { createOpenAiCompatibleAdapter } from './openAiCompatible.js';

export function createOpenAiApiAdapter(): AgentAdapter {
  return createOpenAiCompatibleAdapter('openai-api');
}
