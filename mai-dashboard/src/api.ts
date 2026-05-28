import type { ProjectSummary, Escalation, AgentStatus, Task } from './types.js';

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
