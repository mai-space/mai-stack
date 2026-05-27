export interface RegistryProject {
  id: string;
  name: string;
  workspace_path: string;
  embedding_model: string;
  reindex_threshold_minutes: number;
  last_indexed_at: string | null;
  index_health: string;
}

export async function fetchProjects(registryUrl: string): Promise<RegistryProject[]> {
  const res = await fetch(`${registryUrl}/projects`);
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);
  return res.json() as Promise<RegistryProject[]>;
}

export async function fetchProject(registryUrl: string, projectId: string): Promise<RegistryProject | null> {
  const res = await fetch(`${registryUrl}/projects/${projectId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Registry returned ${res.status}`);
  return res.json() as Promise<RegistryProject>;
}

export async function updateIndexStatus(
  registryUrl: string,
  projectId: string,
  lastIndexedAt: string,
  indexHealth: 'healthy' | 'stale' | 'error'
): Promise<void> {
  const res = await fetch(`${registryUrl}/projects/${projectId}/index-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_indexed_at: lastIndexedAt, index_health: indexHealth }),
  });
  if (!res.ok) console.warn(`[registry] Failed to update index status for ${projectId}: ${res.status}`);
}
