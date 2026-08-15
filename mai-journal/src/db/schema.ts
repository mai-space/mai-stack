export type JournalEntryKind =
  | 'agent_started'
  | 'agent_output'
  | 'gate_result'
  | 'agent_finished'
  | 'run_complete'
  | 'error'
  | 'note';

export interface JournalEntriesTable {
  id: string;
  task_id: string;
  project_id: string | null;
  agent_id: string | null;
  kind: JournalEntryKind;
  payload: string; // JSON
  created_at: string;
}

export interface Database {
  journal_entries: JournalEntriesTable;
}
