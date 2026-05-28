import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { z } from 'zod';

const AgentProfileSchema = z.object({
  id: z.string(),
  type: z.string(),
  model_provider: z.string(),
  model: z.string(),
  task_types: z.array(z.string()),
  max_concurrent_tasks: z.number().int(),
  project_affinity: z.array(z.string()).optional(),
  budget: z.object({
    daily_usd: z.number(),
    per_task_usd: z.number().optional(),
  }).optional(),
  rate_limit: z.object({
    requests_per_minute: z.number(),
    on_429: z.string().optional(),
    on_budget_90pct: z.string().optional(),
  }).optional(),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

let _profiles: AgentProfile[] = [];

export function loadAgentProfiles(configPath: string): AgentProfile[] {
  try {
    const content = readFileSync(configPath, 'utf8');
    const parsed = yaml.load(content) as { agents?: unknown[] };
    _profiles = z.array(AgentProfileSchema).parse(parsed.agents ?? []);
    console.log(`[config] loaded ${_profiles.length} agent profile(s)`);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.warn(`[config] agents.yml not found at ${configPath}; continuing with empty profiles`);
    } else {
      console.warn('[config] failed to load agents.yml:', err.message);
    }
    _profiles = [];
  }
  return _profiles;
}

export function getAgentProfiles(): AgentProfile[] {
  return _profiles;
}
