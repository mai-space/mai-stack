const DELAYS = [2000, 4000, 8000];

export interface Project {
  id: string;
  workspace_path: string;
  embedding_model: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchProjects(registryUrl: string): Promise<Project[]> {
  for (let i = 0; i <= DELAYS.length; i++) {
    try {
      const res = await fetch(`${registryUrl}/projects`);
      if (!res.ok) throw new Error(`Registry returned ${res.status}`);
      return await res.json() as Project[];
    } catch (err) {
      if (i === DELAYS.length) {
        console.warn('[registry] Failed to fetch projects after retries:', (err as Error).message);
        return [];
      }
      await sleep(DELAYS[i]);
    }
  }
  return [];
}
