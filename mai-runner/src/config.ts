import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { z } from 'zod';

// ─── Agent profiles (config/agents.yml) ──────────────────────────────────────
// Superset of mai-dispatcher's AgentProfileSchema — mai-runner only acts on
// entries with mode: managed, but parses the whole file so external-only
// profiles don't fail validation.

const CliConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  timeout_minutes: z.number().positive().default(30),
});

const ApiConfigSchema = z.object({
  base_url: z.string(),
  api_key_env: z.string(),
  model: z.string(),
  timeout_minutes: z.number().positive().default(30),
});

export const AgentProfileSchema = z.object({
  id: z.string(),
  type: z.string(),
  mode: z.enum(['external', 'managed']).default('external'),
  model_provider: z.string().optional(),
  model: z.string().optional(),
  task_types: z.array(z.string()).default([]),
  project_affinity: z.array(z.string()).optional(),
  max_concurrent_tasks: z.number().int().optional(),
  max_parallel_worktrees: z.number().int().positive().default(1),
  max_gate_retries: z.number().int().positive().default(1),
  cli: CliConfigSchema.optional(),
  api: ApiConfigSchema.optional(),
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

export function getManagedProfiles(): AgentProfile[] {
  return _profiles.filter(p => p.mode === 'managed');
}

// ─── Project configs (config/projects.yml) ───────────────────────────────────
// mai-runner reads projects.yml directly (mounted read-only, same file
// mai-registry seeds from) rather than going through the registry API, since
// runtime/quality_gates/repo/pr_strategy are M6-only fields the registry's
// DB schema doesn't carry.

const QualityGateSchema = z.object({
  enabled: z.boolean().default(true),
  command: z.string().optional(),
  mode: z.enum(['dry-run', 'apply']).optional(),
  tool: z.string().optional(),
});

const ProjectRuntimeSchema = z.object({
  type: z.enum(['ddev', 'node', 'none']).default('none'),
  max_parallel_worktrees: z.number().int().positive().default(1),
});

const ProjectRepoSchema = z.object({
  provider: z.enum(['github']).default('github'),
  full_name: z.string(),
  base_branch: z.string().default('main'),
});

export const ProjectConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  workspace: z.string(),
  allowed_agents: z.array(z.string()).default([]),
  repo: ProjectRepoSchema.optional(),
  runtime: ProjectRuntimeSchema.default({ type: 'none', max_parallel_worktrees: 1 }),
  quality_gates: z.object({
    phpstan: QualityGateSchema.optional(),
    rector: QualityGateSchema.optional(),
    e2e: QualityGateSchema.optional(),
  }).default({}),
  pr_strategy: z.enum(['open-pr', 'push-branch-only', 'auto-merge']).default('push-branch-only'),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

let _projects: ProjectConfig[] = [];

export function loadProjectConfigs(configPath: string): ProjectConfig[] {
  try {
    const content = readFileSync(configPath, 'utf8');
    const parsed = yaml.load(content) as { projects?: unknown[] };
    _projects = z.array(ProjectConfigSchema).parse(parsed.projects ?? []);
    console.log(`[config] loaded ${_projects.length} project config(s)`);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      console.warn(`[config] projects.yml not found at ${configPath}; continuing with empty projects`);
    } else {
      console.warn('[config] failed to load projects.yml:', err.message);
    }
    _projects = [];
  }
  return _projects;
}

export function getProjectConfigs(): ProjectConfig[] {
  return _projects;
}

export function getProjectConfig(id: string): ProjectConfig | undefined {
  return _projects.find(p => p.id === id);
}

/** Projects a given managed agent may claim from: its own affinity list, else every runnable project. */
export function getEligibleProjects(profile: AgentProfile): ProjectConfig[] {
  if (profile.project_affinity && profile.project_affinity.length > 0) {
    return _projects.filter(p => profile.project_affinity!.includes(p.id));
  }
  return _projects.filter(p => p.allowed_agents.length === 0 || p.allowed_agents.includes(profile.id));
}
