import type { ProjectSummary, Escalation, AgentStatus, Task, JournalEntry, ActiveRun } from './types.js';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchOverview(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/overview');
  if (!res.ok) throw new Error('Failed to fetch overview');
  return res.json() as Promise<ProjectSummary[]>;
}

export async function fetchEscalations(): Promise<Escalation[]> {
  const res = await fetch('/api/escalations');
  if (!res.ok) throw new Error('Failed to fetch escalations');
  return res.json() as Promise<Escalation[]>;
}

export async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const res = await fetch(`/api/projects/${projectId}/tasks`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json() as Promise<Task[]>;
}

export async function fetchAgents(): Promise<AgentStatus[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json() as Promise<AgentStatus[]>;
}

export function resolveDecision(taskId: string, choice: string): Promise<Task> {
  return post<Task>(`/api/tasks/${taskId}/resolve/decision`, { choice });
}

export function resolveClarification(taskId: string, response: string): Promise<Task> {
  return post<Task>(`/api/tasks/${taskId}/resolve/clarification`, { response });
}

export function resolveRisk(taskId: string, approved: boolean, notes?: string): Promise<Task> {
  return post<Task>(`/api/tasks/${taskId}/resolve/risk`, { approved, notes });
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/auth/check');
    return res.ok;
  } catch {
    return false;
  }
}

export async function login(secret: string): Promise<void> {
  const res = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Login failed');
  }
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST' });
}

export function bulkCloseBlocked(projectId: string): Promise<{ closed: number; task_ids: string[] }> {
  return post<{ closed: number; task_ids: string[] }>(
    `/api/projects/${projectId}/bulk-close-blocked`,
    {}
  );
}

export function resumeAgent(agentId: string): Promise<{ resumed: boolean; previous_state: string; new_state: string }> {
  return post<{ resumed: boolean; previous_state: string; new_state: string }>(
    `/api/agents/${agentId}/resume`,
    {}
  );
}

export async function fetchTaskJournal(taskId: string): Promise<JournalEntry[]> {
  const res = await fetch(`/api/tasks/${taskId}/journal`);
  if (!res.ok) throw new Error('Failed to fetch journal');
  return res.json() as Promise<JournalEntry[]>;
}

export async function fetchActiveRuns(): Promise<ActiveRun[]> {
  const res = await fetch('/api/runs');
  if (!res.ok) throw new Error('Failed to fetch active runs');
  return res.json() as Promise<ActiveRun[]>;
}

export function killRun(taskId: string): Promise<{ task_id: string; killed: boolean }> {
  return post<{ task_id: string; killed: boolean }>(`/api/runs/${taskId}/kill`, {});
}
