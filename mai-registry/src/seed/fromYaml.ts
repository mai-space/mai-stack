import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

interface YamlEmbedding {
  model?: string;
  reindex_threshold_minutes?: number;
}

interface YamlProject {
  id: string;
  name: string;
  workspace: string;
  agents_md?: string;
  system_prompt_override?: string;
  allowed_agents?: string[];
  embedding?: YamlEmbedding;
}

interface YamlConfig {
  projects?: YamlProject[];
}

export async function seedFromYaml(db: Kysely<Database>, configPath: string): Promise<void> {
  if (!existsSync(configPath)) {
    console.warn(`[seed] Config file not found at ${configPath}, starting with empty registry`);
    return;
  }

  const raw = readFileSync(configPath, 'utf8');
  const config = yaml.load(raw) as YamlConfig;
  const projects = config?.projects ?? [];

  if (projects.length === 0) {
    console.log('[seed] No projects in config');
    return;
  }

  const now = new Date().toISOString();
  let count = 0;

  for (const p of projects) {
    await db
      .insertInto('projects')
      .values({
        id: p.id,
        name: p.name,
        slug: p.id,
        workspace_path: p.workspace,
        agents_md_path: p.agents_md ?? null,
        system_prompt_override: p.system_prompt_override ?? null,
        allowed_agent_ids: JSON.stringify(p.allowed_agents ?? []),
        embedding_model: p.embedding?.model ?? 'ollama:nomic-embed-text',
        reindex_threshold_minutes: p.embedding?.reindex_threshold_minutes ?? 15,
        last_indexed_at: null,
        index_health: 'unknown',
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: p.name,
          slug: p.id,
          workspace_path: p.workspace,
          agents_md_path: p.agents_md ?? null,
          system_prompt_override: p.system_prompt_override ?? null,
          allowed_agent_ids: JSON.stringify(p.allowed_agents ?? []),
          embedding_model: p.embedding?.model ?? 'ollama:nomic-embed-text',
          reindex_threshold_minutes: p.embedding?.reindex_threshold_minutes ?? 15,
          updated_at: now,
          // last_indexed_at and index_health are NOT updated — runtime state
        })
      )
      .execute();
    count++;
  }

  console.log(`[seed] Upserted ${count} project(s) from ${configPath}`);
}
