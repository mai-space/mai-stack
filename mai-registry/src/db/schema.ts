export interface ProjectsTable {
  id: string;
  name: string;
  slug: string;
  workspace_path: string;
  agents_md_path: string | null;
  system_prompt_override: string | null;
  allowed_agent_ids: string; // JSON string of string[]
  embedding_model: string;
  reindex_threshold_minutes: number;
  last_indexed_at: string | null;
  index_health: string;
  created_at: string;
  updated_at: string;
}

export interface Database {
  projects: ProjectsTable;
}
