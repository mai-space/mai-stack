const JOURNAL_URL = process.env.JOURNAL_URL ?? 'http://mai-journal:3462';

export type JournalKind =
  | 'agent_started'
  | 'agent_output'
  | 'gate_result'
  | 'agent_finished'
  | 'run_complete'
  | 'error'
  | 'note';

export async function appendJournal(
  taskId: string,
  kind: JournalKind,
  payload: unknown,
  meta: { projectId?: string; agentId?: string } = {}
): Promise<void> {
  try {
    await fetch(`${JOURNAL_URL}/journal/${taskId}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: meta.projectId, agent_id: meta.agentId, kind, payload }),
    });
  } catch (err) {
    // journaling must never take down a run — log locally and move on
    console.warn(`[journal] failed to append ${kind} for task ${taskId}:`, String(err));
  }
}
