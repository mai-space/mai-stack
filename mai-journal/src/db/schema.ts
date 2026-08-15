import type { Generated } from 'kysely';

export type JournalEntryKind =
  | 'agent_started'
  | 'agent_output'
  | 'gate_result'
  | 'agent_finished'
  | 'run_complete'
  | 'error'
  | 'note';

export interface JournalEntriesTable {
  // Auto-incrementing, not a UUID: entries are read back in insertion order (live-tail's
  // `since` cursor relies on strict ordering, which a random id can't provide).
  id: Generated<number>;
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
