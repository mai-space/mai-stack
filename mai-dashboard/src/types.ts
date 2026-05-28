export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
export type BlockerType = 'SUBTASK' | 'DECISION' | 'CLARIFICATION' | 'DEPENDENCY' | 'CAPABILITY' | 'RISK';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assigned_agent: string | null;
  blocker_type: BlockerType | null;
  blocker_payload: string;
  blocker_resolved_at: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  open: number;
  inProgress: number;
  blocked: number;
  done: number;
  escalations: number;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  workspace_path: string;
  description?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
}

export interface Escalation {
  task_id: string;
  task_title: string;
  project_id: string;
  project_name: string;
  blocker_type: 'DECISION' | 'CLARIFICATION' | 'RISK';
  question?: string;
  options?: string[];
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  created_at: string;
  updated_at: string;
}

export interface AgentStatus {
  id: string;
  type: string;
  model_provider: string;
  model: string;
  state: string;
  daily_usd: number;
  spent_usd: number;
  pct: number;
  active_tasks: number;
  provider: string;
  provider_spent_usd: number;
}

export interface WsEvent {
  channel: string;
  payload: Record<string, unknown>;
}

export interface AuthState {
  authenticated: boolean;
  loading: boolean;
}
