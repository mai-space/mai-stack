export interface ProjectsTable {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
export type BlockerType = 'SUBTASK' | 'DECISION' | 'CLARIFICATION' | 'DEPENDENCY' | 'CAPABILITY' | 'RISK';

export interface TasksTable {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  assigned_agent: string | null;
  lease_expires_at: string | null;
  parent_task_id: string | null;
  blocker_type: BlockerType | null;
  blocker_payload: string; // JSON
  blocker_resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Database {
  projects: ProjectsTable;
  tasks: TasksTable;
}
